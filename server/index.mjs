import cors from 'cors'
import express from 'express'
import process from 'node:process'

const app = express()
const port = process.env.API_PORT || 3001
const cache = new Map()

app.use(cors())
app.use(express.json())

async function geocodeZip(zip) {
  const cacheKey = `geocode:${zip}`
  if (cache.has(cacheKey)) return cache.get(cacheKey)

  const url = `https://nominatim.openstreetmap.org/search?postalcode=${encodeURIComponent(zip)}&countrycodes=us&format=jsonv2&addressdetails=1&limit=1`
  const response = await fetch(url, {
    headers: { 'User-Agent': 'EOTC-Service-Finder/1.0' },
    signal: AbortSignal.timeout(10000),
  })
  if (response.status === 429) throw new Error('Location lookup is temporarily limited. Please try again.')
  if (!response.ok) throw new Error('Unable to locate ZIP code.')

  const matches = await response.json()
  if (!Array.isArray(matches) || matches.length === 0) {
    throw new Error('ZIP code not found.')
  }

  const match = matches[0]
  const lat = Number(match.lat)
  const lon = Number(match.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error('ZIP code not found.')
  }

  const address = match.address || {}
  const location = {
    lat,
    lon,
    city: address.city || address.town || address.village || address.county || 'Selected area',
    state: address.state || '',
  }
  cache.set(cacheKey, location)
  return location
}

function haversineMiles(first, second) {
  const earthRadiusMiles = 3959
  const toRadians = (degrees) => degrees * (Math.PI / 180)
  const latDelta = toRadians(second.lat - first.lat)
  const lonDelta = toRadians(second.lon - first.lon)
  const lat1 = toRadians(first.lat)
  const lat2 = toRadians(second.lat)
  const haversine =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(lonDelta / 2) ** 2

  return 2 * earthRadiusMiles * Math.asin(Math.sqrt(haversine))
}

async function queryOverpass(query) {
  const endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
  ]
  let lastError

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(`${endpoint}?${new URLSearchParams({ data: query })}`, {
        headers: { 'User-Agent': 'EOTC-Service-Finder/1.0' },
        signal: AbortSignal.timeout(15000),
      })
      if (!response.ok) {
        lastError = new Error(`Overpass returned ${response.status}`)
        continue
      }
      return response.json()
    } catch (error) {
      lastError = error
    }
  }

  throw lastError || new Error('Unable to search nearby services.')
}

async function queryNominatimChurches(location, radius) {
  const latitudeRadius = radius / 69
  const longitudeRadius = radius / (69 * Math.max(Math.cos(location.lat * Math.PI / 180), 0.3))
  const west = location.lon - longitudeRadius
  const east = location.lon + longitudeRadius
  const north = location.lat + latitudeRadius
  const south = location.lat - latitudeRadius
  const url = `https://nominatim.openstreetmap.org/search?` +
    new URLSearchParams({
      q: 'Ethiopian Orthodox Tewahedo church',
      countrycodes: 'us',
      format: 'jsonv2',
      addressdetails: '1',
      extratags: '1',
      namedetails: '1',
      limit: '50',
      viewbox: `${west},${north},${east},${south}`,
      bounded: '1',
    })

  const response = await fetch(url, {
    headers: { 'User-Agent': 'EOTC-Service-Finder/1.0' },
    signal: AbortSignal.timeout(10000),
  })
  if (!response.ok) {
    throw new Error('Nearby service search is temporarily unavailable.')
  }

  const matches = await response.json()
  return (Array.isArray(matches) ? matches : []).flatMap((match) => {
    const lat = Number(match.lat)
    const lon = Number(match.lon)
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return []

    const identityText = [
      match.name,
      match.display_name,
      match.namedetails?.name,
      match.namedetails?.['name:en'],
      match.extratags?.denomination,
      match.extratags?.religion,
    ].filter(Boolean).join(' ').toLowerCase()

    if (!/(ethiopian orthodox|ethiopian tewahedo|tewahedo|ተዋሕዶ|ኢትዮጵያ)/i.test(identityText)) return []

    const distance = haversineMiles(location, { lat, lon })
    if (distance > radius) return []

    const address = match.address || {}
    const addressParts = [
      address.house_number,
      address.road,
      address.city || address.town || address.village,
      address.state,
      address.postcode,
    ].filter(Boolean)

    return [{
      id: `osm-${match.osm_type}-${match.osm_id}`,
      name: match.name || match.display_name || 'Ethiopian Orthodox church',
      address: addressParts.join(', ') || 'Address not provided',
      distance: Number(distance.toFixed(1)),
      lat,
      lon,
      denomination: match.extratags?.denomination || 'Ethiopian Orthodox Tewahedo',
      phone: match.extratags?.phone || match.extratags?.['contact:phone'] || null,
      website: match.extratags?.website || match.extratags?.['contact:website'] || null,
      wheelchair: match.extratags?.wheelchair || 'unknown',
      scheduleStatus: 'Schedule not verified',
      schedule: null,
      source: 'OpenStreetMap',
      osmUrl: `https://www.openstreetmap.org/${match.osm_type}/${match.osm_id}`,
    }]
  })
}

app.get('/api/health', (_request, response) => {
  response.json({ status: 'ok' })
})

app.get('/api/services', async (request, response) => {
  const zip = String(request.query.zip || '')
  const category = String(request.query.category || 'All activities')
  const radius = Number(request.query.radius || 25)

  if (!/^\d{5}$/.test(zip)) {
    return response.status(400).json({ error: 'A valid 5-digit ZIP code is required.' })
  }
  if (!Number.isFinite(radius) || radius < 1 || radius > 100) {
    return response.status(400).json({ error: 'Radius must be between 1 and 100 miles.' })
  }

  try {
    const location = await geocodeZip(zip)
    const cacheKey = `services:${zip}:${category}:${radius}`
    if (cache.has(cacheKey)) {
      return response.json(cache.get(cacheKey))
    }

    const radiusMeters = Math.round(radius * 1609.344)
    const categoryTerms = {
      'Yearly Feast': ['feast', 'festival', 'annual'],
      'Week Day Mass': ['mass'],
      'Bible Study': ['bible', 'study'],
      'Week Day Matins': ['matins', 'morning prayer'],
      'Week Day Vespers': ['vespers', 'evening prayer'],
    }
    const terms = categoryTerms[category]
    const query = `[out:json][timeout:25];
      (
        nwr["amenity"="place_of_worship"]["religion"="christian"](around:${radiusMeters},${location.lat},${location.lon});
        nwr["amenity"="place_of_worship"]["name"~"Ethiopian|Tewahedo|ተዋሕዶ|ኢትዮጵያ",i](around:${radiusMeters},${location.lat},${location.lon});
        nwr["building"="church"]["denomination"~"ethiopian|tewahedo",i](around:${radiusMeters},${location.lat},${location.lon});
      );
      out center tags;`

    let overpass
    try {
      overpass = await queryOverpass(query)
    } catch {
      overpass = { elements: [] }
      const fallbackServices = await queryNominatimChurches(location, radius)
      if (fallbackServices.length > 0) {
        const payload = {
          zip,
          location,
          radius,
          category,
          searchType: 'Ethiopian Orthodox Tewahedo churches',
          services: fallbackServices,
        }
        cache.set(cacheKey, payload)
        return response.json(payload)
      }
    }
    let services = (overpass.elements || []).flatMap((element) => {
      const lat = element.lat ?? element.center?.lat
      const lon = element.lon ?? element.center?.lon
      if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) return []

      const tags = element.tags || {}
      const name = tags.name || tags['name:en'] || 'Unnamed place of worship'
      const identityText = [
        name,
        tags['name:en'],
        tags['alt_name'],
        tags['old_name'],
        tags.description,
        tags.note,
        tags.denomination,
        tags['denomination:en'],
        tags.operator,
        tags.brand,
      ].filter(Boolean).join(' ').toLowerCase()

      const ethiopianIdentity =
        /ethiopian orthodox|ethiopian tewahedo|ethiopian|tewahedo|ሰንበት\s+ቤተ|ተዋሕዶ|ኢትዮጵያ/.test(identityText) ||
        /ethiopian|tewahedo/.test(String(tags.denomination || '').toLowerCase())

      if (!ethiopianIdentity) return []

      const searchableText = [
        identityText,
        tags.service_times,
        tags.opening_hours,
        tags['opening_hours:mass'],
        tags['opening_hours:vespers'],
        tags['opening_hours:matins'],
      ].filter(Boolean).join(' ').toLowerCase()
      if (terms && !terms.some((term) => searchableText.includes(term))) return []

      const addressParts = [
        tags['addr:housenumber'],
        tags['addr:street'],
        tags['addr:city'],
        tags['addr:state'],
        tags['addr:postcode'],
      ].filter(Boolean)
      const distance = haversineMiles(location, { lat: Number(lat), lon: Number(lon) })
      if (distance > radius) return []

      return [{
        id: `osm-${element.type}-${element.id}`,
        name,
        address: addressParts.join(', ') || 'Address not provided',
        distance: Number(distance.toFixed(1)),
        lat: Number(lat),
        lon: Number(lon),
        denomination: tags.denomination || null,
        phone: tags.phone || tags['contact:phone'] || null,
        website: tags.website || tags['contact:website'] || null,
        wheelchair: tags.wheelchair || 'unknown',
        scheduleStatus: tags.service_times
          ? 'Service times provided'
          : 'Service times not provided',
        schedule: tags.service_times || null,
        source: 'OpenStreetMap',
        osmUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`,
      }]
    })

    services.sort((first, second) => first.distance - second.distance)
    const payload = {
      zip,
      location,
      radius,
      category,
      searchType: 'Ethiopian Orthodox Tewahedo churches',
      services,
    }
    cache.set(cacheKey, payload)
    return response.json(payload)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to complete the search.'
    const status = message.includes('ZIP code not found') ? 404 : 502
    return response.status(status).json({ error: message })
  }
})

app.listen(port, () => {
  console.log(`API server listening at http://localhost:${port}`)
})
