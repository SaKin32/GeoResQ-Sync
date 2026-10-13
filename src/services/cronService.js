const cron = require('node-cron');
const https = require('https');
const { pool } = require('../config/db');

// Helper to fetch JSON from HTTPS
const fetchJson = (url) => {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'DisasterRescueCoordinator/1.0' } }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', (err) => reject(err));
  });
};

// Fetch seismic events from USGS Earthquake API (Free, Public GeoJSON)
const fetchUsgsEarthquakes = async () => {
  try {
    console.log('[USGS] Checking Earthquake Feed...');
    const url = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson';
    const json = await fetchJson(url);

    if (json && json.features && json.features.length > 0) {
      let savedCount = 0;
      for (const feature of json.features.slice(0, 5)) {
        const title = feature.properties.title;
        const mag = feature.properties.mag;
        const place = feature.properties.place;
        const time = new Date(feature.properties.time);
        const severity = mag >= 6.5 ? 'CRITICAL' : mag >= 5.0 ? 'HIGH' : 'MEDIUM';

        // Check if alert already exists
        const [existing] = await pool.execute(
          'SELECT id FROM disaster_alerts WHERE alert_title = ? LIMIT 1',
          [title]
        );

        if (existing.length === 0) {
          await pool.execute(
            `INSERT INTO disaster_alerts (source_api, alert_title, description, severity, event_time)
             VALUES (?, ?, ?, ?, ?)`,
            [
              'USGS Earthquake API',
              title,
              `Seismic activity of magnitude ${mag} detected near ${place}.`,
              severity,
              time
            ]
          );
          savedCount++;
        }
      }
      if (savedCount > 0) {
        console.log(`[USGS] Inserted ${savedCount} new earthquake alerts from USGS.`);
      }
    }
  } catch (error) {
    console.warn('[USGS Warning] Could not fetch USGS Earthquakes:', error.message);
  }
};

// Initialize Background Cron Schedule (Default: Every 30 minutes)
const startDisasterAlertCron = () => {
  const schedulePattern = process.env.CRON_SCHEDULE || '*/30 * * * *';

  cron.schedule(schedulePattern, async () => {
    console.log(`[CRON] Triggered: Updating disaster alerts (${new Date().toISOString()})`);
    await fetchUsgsEarthquakes();
  });

  console.log(`[CRON] Disaster Alert Cron Job scheduled with pattern: [${schedulePattern}]`);
  
  // Also run once on startup
  fetchUsgsEarthquakes().catch(() => {});
};

module.exports = {
  startDisasterAlertCron,
  fetchUsgsEarthquakes
};
