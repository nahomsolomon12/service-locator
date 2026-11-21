import { useCallback, useEffect, useState } from 'react'
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

function EventSubmissionDialog({ onClose }) {
  const [submitted, setSubmitted] = useState(false)

  function submitEvent(event) {
    event.preventDefault()
    setSubmitted(true)
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="event-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="event-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button type="button" className="dialog-close" onClick={onClose} aria-label="Close event form">
          &times;
        </button>
        {submitted ? (
          <div className="event-confirmation">
            <p className="eyebrow">Thank you</p>
            <h2 id="event-dialog-title">Your event details were received.</h2>
            <p>We will review the information and follow up if needed.</p>
            <button type="button" className="dialog-submit" onClick={onClose}>Done</button>
          </div>
        ) : (
          <>
            <p className="eyebrow">Community events</p>
            <h2 id="event-dialog-title">Add an event</h2>
            <p className="dialog-intro">Share an upcoming event with visitors to the service finder.</p>
            <form className="event-form" onSubmit={submitEvent}>
              <label>
                Event name
                <input type="text" name="eventName" required />
              </label>
              <label>
                Event type
                <select name="eventCategory" defaultValue="" required>
                  <option value="" disabled>Select an event type</option>
                  <option>Yearly Feast</option>
                  <option>Week Day Mass</option>
                  <option>Bible Study</option>
                  <option>Week Day Matins</option>
                  <option>Week Day Vespers</option>
                </select>
              </label>
              <label>
                Date
                <input type="date" name="eventDate" required />
              </label>
              <label>
                Location
                <input type="text" name="eventLocation" required />
              </label>
              <label>
                Details
                <textarea name="eventDetails" rows="3" placeholder="Add service times or other helpful details" />
              </label>
              <label>
                Contact email
                <input type="email" name="contactEmail" required />
              </label>
              <button type="submit" className="dialog-submit">Submit event</button>
            </form>
          </>
        )}
      </section>
    </div>
  )
}

function App() {
  const initialParams = new URLSearchParams(window.location.search)
  const initialZip = window.location.pathname === '/results'
    ? initialParams.get('zip') || ''
    : ''
  const [isResultsPage, setIsResultsPage] = useState(window.location.pathname === '/results')
  const [zipCode, setZipCode] = useState(initialZip)
  const [category, setCategory] = useState(initialParams.get('category') || 'All activities')
  const [radius, setRadius] = useState(initialParams.get('radius') || '25')
  const [results, setResults] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [isEventFormOpen, setIsEventFormOpen] = useState(false)

  const searchServices = useCallback(async (
    zip,
    selectedCategory = 'All activities',
    selectedRadius = '25',
  ) => {
    setLoading(true)
    setError('')

    try {
      const params = new URLSearchParams({
        zip,
        category: selectedCategory,
        radius: selectedRadius,
      })
      const response = await fetch(`/api/services?${params}`)
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Unable to find services.')
      if (body.services.length === 0) {
        setResults(body)
        setError(`No matching services within ${body.radius} miles.`)
        return
      }
      setResults(body)
    } catch (requestError) {
      setError(requestError.message)
      setResults(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const zip = params.get('zip')
    if (window.location.pathname === '/results' && /^\d{5}$/.test(zip || '')) {
      queueMicrotask(() => {
        searchServices(
          zip,
          params.get('category') || 'All activities',
          params.get('radius') || '25',
        )
      })
    }

    const onPopState = () => {
      const nextParams = new URLSearchParams(window.location.search)
      const nextZip = nextParams.get('zip') || ''
      if (window.location.pathname === '/results') {
        setIsResultsPage(true)
        const nextCategory = nextParams.get('category') || 'All activities'
        const nextRadius = nextParams.get('radius') || '25'
        setZipCode(nextZip)
        setCategory(nextCategory)
        setRadius(nextRadius)
        if (/^\d{5}$/.test(nextZip)) {
          searchServices(nextZip, nextCategory, nextRadius)
        }
      } else {
        setIsResultsPage(false)
        setResults(null)
        setError('')
      }
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [searchServices])

  function submitSearch(event) {
    event.preventDefault()
    if (!/^\d{5}$/.test(zipCode)) {
      setError('Enter a valid 5-digit ZIP code.')
      return
    }

    const params = new URLSearchParams({
      zip: zipCode,
      category,
      radius,
    })
    window.history.pushState({}, '', `/results?${params}`)
    setIsResultsPage(true)
    searchServices(zipCode, category, radius)
  }

  if (isResultsPage) {
    return (
      <main className="results-page">
        <header className="results-header">
          <button
            type="button"
            className="brand-button"
            onClick={() => {
              window.history.pushState({}, '', '/')
              setIsResultsPage(false)
              setResults(null)
              setError('')
            }}
          >
            EOTC Service Finder
          </button>
          <div className="results-header-actions">
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
              <select
                className="filter-select"
                aria-label="Activity"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
              >
                <option>All activities</option>
                <option>Yearly Feast</option>
                <option>Week Day Mass</option>
                <option>Bible Study</option>
                <option>Week Day Matins</option>
                <option>Week Day Vespers</option>
              </select>
              <select
                className="filter-select"
                aria-label="Search radius"
                value={radius}
                onChange={(event) => setRadius(event.target.value)}
              >
                <option value="5">5 miles</option>
                <option value="10">10 miles</option>
                <option value="25">25 miles</option>
                <option value="50">50 miles</option>
              </select>
              <button type="submit" disabled={loading}>Search</button>
            </form>
            <button type="button" className="add-event-button" onClick={() => setIsEventFormOpen(true)}>
              Add an event
            </button>
          </div>
        </header>

        <section className="results-layout">
          <div className="results-list">
            <p className="eyebrow">Results near {zipCode}</p>
            <h1>Ethiopian Orthodox churches</h1>
            {loading && <p className="status-message">Finding Ethiopian Orthodox churches...</p>}
            {error && <p className="status-message error" role="alert">{error}</p>}
            {!loading && results && results.services.map((service) => (
              <article className="service-card" key={service.id}>
                <div>
                  <h2>{service.name}</h2>
                  <p>{service.address}</p>
                  {service.phone && <p>{service.phone}</p>}
                  <p>{service.scheduleStatus}</p>
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
        {isEventFormOpen && <EventSubmissionDialog onClose={() => setIsEventFormOpen(false)} />}
      </main>
    )
  }

  return (
    <main className="finder">
      <button type="button" className="add-event-button home-add-event" onClick={() => setIsEventFormOpen(true)}>
        Add an event
      </button>
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
        <label className="home-filter">
          <span>Activity</span>
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option>All activities</option>
            <option>Yearly Feast</option>
            <option>Week Day Mass</option>
            <option>Bible Study</option>
            <option>Week Day Matins</option>
            <option>Week Day Vespers</option>
          </select>
        </label>
        <label className="home-filter">
          <span>Radius</span>
          <select value={radius} onChange={(event) => setRadius(event.target.value)}>
            <option value="5">5 miles</option>
            <option value="10">10 miles</option>
            <option value="25">25 miles</option>
            <option value="50">50 miles</option>
          </select>
        </label>
        <button className="search-button" type="submit">Search</button>
      </form>
      {error && <p id="zip-error" className="home-error" role="alert">{error}</p>}
      {isEventFormOpen && <EventSubmissionDialog onClose={() => setIsEventFormOpen(false)} />}
    </main>
  )
}

export default App
