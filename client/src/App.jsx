import { useEffect, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './App.css'

function ResultsMap({ location, services }) {
  useEffect(() => {
    if (!location) return

    const map = L.map('service-map', {
      scrollWheelZoom: false,
    }).setView([location.lat, location.lon], 12)

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map)

    const bounds = [[location.lat, location.lon]]
    services.forEach((service) => {
      const position = [service.lat, service.lon]
      bounds.push(position)
      L.circleMarker(position, {
        radius: 7,
        color: '#ffffff',
        weight: 2,
        fillColor: '#2f67f6',
        fillOpacity: 1,
      })
        .addTo(map)
        .bindPopup(`<strong>${service.name}</strong><br>${service.address}`)
    })

    L.circleMarker([location.lat, location.lon], {
      radius: 9,
      color: '#ffffff',
      weight: 3,
      fillColor: '#1c2433',
      fillOpacity: 1,
    })
      .addTo(map)
      .bindPopup('Search area')

    map.fitBounds(bounds, { padding: [35, 35], maxZoom: 13 })

    return () => map.remove()
  }, [location, services])

  return <div id="service-map" className="service-map" aria-label="Service locations map" />
}

function App() {
  const initialParams = new URLSearchParams(window.location.search)
  const initialZip = window.location.pathname === '/results'
    ? initialParams.get('zip') || ''
    : ''
  const [zipCode, setZipCode] = useState(initialZip)
  const [results, setResults] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const zip = params.get('zip')
    if (window.location.pathname === '/results' && /^\d{5}$/.test(zip || '')) {
      searchServices(zip)
    }

    const onPopState = () => window.location.reload()
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  async function searchServices(zip) {
    setLoading(true)
    setError('')

    try {
      const response = await fetch(`/api/services?zip=${encodeURIComponent(zip)}`)
      if (!response.ok) throw new Error('Unable to find services.')
      setResults(await response.json())
    } catch (requestError) {
      setError(requestError.message)
      setResults(null)
    } finally {
      setLoading(false)
    }
  }

  function submitSearch(event) {
    event.preventDefault()
    if (!/^\d{5}$/.test(zipCode)) {
      setError('Enter a valid 5-digit ZIP code.')
      return
    }

    window.history.pushState({}, '', `/results?zip=${zipCode}`)
    searchServices(zipCode)
  }

  if (window.location.pathname === '/results') {
    return (
      <main className="results-page">
        <header className="results-header">
          <button
            type="button"
            className="brand-button"
            onClick={() => {
              window.history.pushState({}, '', '/')
              setResults(null)
              setError('')
              window.location.reload()
            }}
          >
            EOTC Service Finder
          </button>
          <form className="header-search" onSubmit={submitSearch}>
            <label htmlFor="header-zip" className="sr-only">ZIP Code</label>
            <input
              id="header-zip"
              type="text"
              inputMode="numeric"
              maxLength={5}
              value={zipCode}
              onChange={(event) => setZipCode(event.target.value.replace(/\D/g, ''))}
              placeholder="ZIP code"
            />
            <button type="submit" disabled={loading}>Search</button>
          </form>
        </header>

        <section className="results-layout">
          <div className="results-list">
            <p className="eyebrow">Results near {zipCode}</p>
            <h1>Available services</h1>
            {loading && <p className="status-message">Finding nearby services...</p>}
            {error && <p className="status-message error" role="alert">{error}</p>}
            {!loading && results && results.services.map((service) => (
              <article className="service-card" key={service.id}>
                <div>
                  <h2>{service.name}</h2>
                  <p>{service.address}</p>
                </div>
                <span>{service.distance} mi</span>
              </article>
            ))}
          </div>
          <div className="map-panel">
            {results ? (
              <ResultsMap location={results.location} services={results.services} />
            ) : (
              <div className="map-placeholder">Map loading</div>
            )}
          </div>
        </section>
      </main>
    )
  }

  return (
    <main className="finder">
      <h1>EOTC Service Finder</h1>
      <form className="search-form" onSubmit={submitSearch}>
        <label className="zip-field" htmlFor="zip-code">
          <span>ZIP Code</span>
          <input
            id="zip-code"
            name="zipCode"
            type="text"
            inputMode="numeric"
            autoComplete="postal-code"
            placeholder="Enter ZIP code"
            maxLength={5}
            value={zipCode}
            onChange={(event) =>
              setZipCode(event.target.value.replace(/\D/g, ''))
            }
            aria-describedby={error ? 'zip-error' : undefined}
          />
        </label>
        <button className="search-button" type="submit">Search</button>
      </form>
      {error && <p id="zip-error" className="home-error" role="alert">{error}</p>}
    </main>
  )
}

export default App
