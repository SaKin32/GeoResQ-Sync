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

// 1. Fetch seismic events from USGS Earthquake API (Free, Public GeoJSON)
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

// 2. Fetch or Sync Weather & Flood Warning Alerts
const fetchWeatherAndFloodAlerts = async () => {
  try {
    console.log('[WEATHER] Checking Flood & Meteorological Warning Feeds...');
    const apiKey = process.env.OPENWEATHER_API_KEY;

    if (apiKey && apiKey !== 'your_openweather_api_key') {
      // Query OpenWeather for Sylhet
      const weatherUrl = `https://api.openweathermap.org/data/2.5/weather?lat=24.8949&lon=91.8687&appid=${apiKey}&units=metric`;
      try {
        const data = await fetchJson(weatherUrl);
        if (data && data.weather) {
          const mainDesc = data.weather[0].description;
          const rain = data.rain ? (data.rain['1h'] || 0) : 0;
          const isHeavy = rain > 10 || data.weather[0].main.toLowerCase().includes('rain');

          const alertTitle = `OpenWeather Live Alert: ${data.name} (${data.weather[0].main})`;
          const severity = rain > 25 ? 'CRITICAL' : isHeavy ? 'HIGH' : 'MEDIUM';

          const [existing] = await pool.execute(
            'SELECT id FROM disaster_alerts WHERE alert_title = ? LIMIT 1',
            [alertTitle]
          );

          if (existing.length === 0) {
            await pool.execute(
              `INSERT INTO disaster_alerts (source_api, alert_title, description, severity, event_time)
               VALUES (?, ?, ?, ?, NOW())`,
              [
                'OpenWeather API',
                alertTitle,
                `Condition: ${mainDesc}. Temp: ${data.main.temp}°C, Humidity: ${data.main.humidity}%, Rain (1h): ${rain}mm.`,
                severity
              ]
            );
          }
        }
      } catch (err) {
        console.warn('[OpenWeather Warning] Error calling OpenWeather API:', err.message);
      }
    } else {
      // Automatic Localized Early-Warning Feed (BMD & FFWC Simulation)
      const mockFloodAlerts = [
        {
          source: 'Flood Forecasting & Warning Centre (FFWC)',
          title: 'Surma River Water Level Flash Alert',
          description: 'Water level at Kanaighat and Sylhet points is flowing 65cm above the respective danger limits. Low-lying areas inundated.',
          severity: 'CRITICAL'
        },
        {
          source: 'Bangladesh Meteorological Department (BMD)',
          title: 'Heavy Rainfall Warning for Northeastern Region',
          description: 'Active monsoon depression leading to rainfall exceeding 120mm in next 24 hours. Landslides possible in hilly terrains.',
          severity: 'HIGH'
        }
      ];

      for (const alert of mockFloodAlerts) {
        const [existing] = await pool.execute(
          'SELECT id FROM disaster_alerts WHERE alert_title = ? LIMIT 1',
          [alert.title]
        );
        if (existing.length === 0) {
          await pool.execute(
            `INSERT INTO disaster_alerts (source_api, alert_title, description, severity, event_time)
             VALUES (?, ?, ?, ?, NOW())`,
            [alert.source, alert.title, alert.description, alert.severity]
          );
        }
      }
    }
  } catch (error) {
    console.warn('[WEATHER Warning] Error updating weather alerts:', error.message);
  }
};

// 3. Initialize Background Cron Schedule (Default: Every 30 minutes)
const startDisasterAlertCron = () => {
  const schedulePattern = process.env.CRON_SCHEDULE || '*/30 * * * *';

  cron.schedule(schedulePattern, async () => {
    console.log(`[CRON] Triggered: Updating disaster alerts (${new Date().toISOString()})`);
    await fetchUsgsEarthquakes();
    await fetchWeatherAndFloodAlerts();
  });

  console.log(`[CRON] Disaster Alert Cron Job scheduled with pattern: [${schedulePattern}]`);
  
  // Also run once on startup
  fetchUsgsEarthquakes().catch(() => {});
  fetchWeatherAndFloodAlerts().catch(() => {});
};

module.exports = {
  startDisasterAlertCron,
  fetchUsgsEarthquakes,
  fetchWeatherAndFloodAlerts
};
