import cors from 'cors'
import express from 'express'
import process from 'node:process'

const app = express()
const port = process.env.API_PORT || 3001

app.use(cors())
app.use(express.json())

const fallbackLocations = {
  '10001': { lat: 40.7506, lon: -73.9971, city: 'New York, NY' },
  '90210': { lat: 34.0901, lon: -118.4065, city: 'Beverly Hills, CA' },
  '60601': { lat: 41.8864, lon: -87.6222, city: 'Chicago, IL' },
  '78701': { lat: 30.2672, lon: -97.7431, city: 'Austin, TX' },
}

async function geocodeZip(zip) {
  if (fallbackLocations[zip]) return fallbackLocations[zip]

  const url = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(zip)}&benchmark=Public_AR_Current&format=json`
  const response = await fetch(url)
  if (!response.ok) throw new Error('Unable to locate ZIP code.')

  const data = await response.json()
  const match = data.result?.addressMatches?.[0]
  if (!match) throw new Error('ZIP code not found.')

  return {
    lat: match.coordinates.y,
    lon: match.coordinates.x,
    city: match.addressComponents?.place || 'Selected area',
  }
}

app.get('/api/health', (_request, response) => {
  response.json({ status: 'ok' })
})

app.get('/api/services', async (request, response) => {
  const zip = String(request.query.zip || '')
  if (!/^\d{5}$/.test(zip)) {
    return response.status(400).json({ error: 'A valid 5-digit ZIP code is required.' })
  }

  try {
    const location = await geocodeZip(zip)
    const offsets = [
      [0.012, 0.014, 'Eastside Community Service', '1.2 mi'],
      [-0.009, 0.018, 'Community Care Center', '2.0 mi'],
      [0.018, -0.012, 'Neighborhood Support Hub', '2.8 mi'],
      [-0.017, -0.016, 'Family Resource Office', '3.4 mi'],
    ]

    const services = offsets.map(([latOffset, lonOffset, name, distance], index) => ({
      id: `${zip}-${index + 1}`,
      name,
      address: `${120 + index * 37} Main Street`,
      distance,
      lat: location.lat + latOffset,
      lon: location.lon + lonOffset,
    }))

    return response.json({ zip, location, services })
  } catch (error) {
    return response.status(404).json({ error: error.message })
  }
})

app.listen(port, () => {
  console.log(`API server listening at http://localhost:${port}`)
})
