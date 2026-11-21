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
        nwr["amenity"="place_of_worship"](around:${radiusMeters},${location.lat},${location.lon});
        nwr["building"="church"](around:${radiusMeters},${location.lat},${location.lon});
      );
      out center tags;`

    const overpassResponse = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'EOTC-Service-Finder/1.0',
      },
      body: new URLSearchParams({ data: query }),
      signal: AbortSignal.timeout(25000),
    })
    if (overpassResponse.status === 429) {
      throw new Error('Service search is temporarily limited. Please try again.')
    }
    if (!overpassResponse.ok) {
      throw new Error('Unable to search nearby services.')
    }

    const overpass = await overpassResponse.json()
    let services = (overpass.elements || []).flatMap((element) => {
      const lat = element.lat ?? element.center?.lat
      const lon = element.lon ?? element.center?.lon
      if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) return []

      const tags = element.tags || {}
      const name = tags.name || tags['name:en'] || 'Unnamed place of worship'
      const searchableText = [
        name,
        tags.description,
        tags.note,
        tags.denomination,
        tags.service_times,
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
      services,
    }
    cache.set(cacheKey, payload)
    return response.json(payload)
  } catch (error) {
    return response.status(404).json({ error: error.message })
  }
})

app.listen(port, () => {
  console.log(`API server listening at http://localhost:${port}`)
})
