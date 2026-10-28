// index.js
import express from 'express';
import session from 'express-session';
import passport from 'passport';
import path from 'path';
import { fileURLToPath } from 'url';

import './config/passport.js';              
import routes, {liveMatchUpdates} from './routes/routes.js';
import {startLiveMatchNotifications} from './config/liveMatchNotifications.js';
import { siteApiHealth } from './config/siteAnalytics.js';

import cors from 'cors';

import dotenv from 'dotenv';
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
// Nginx runs on the same host; trust its forwarded client address, not arbitrary public proxies.
app.set('trust proxy', 'loopback');
const SERVER_PORT = process.env.SERVER_PORT || 3000;

app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true
}));
app.use(siteApiHealth);

// Session setup
app.use(session({
  secret: 'your-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // must be false for localhost unless using HTTPS
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));

app.use('/api/site-analytics', express.json({ limit: '8kb' }));
app.use('/api/signup', express.json({ limit: '16mb' }));
app.use('/api/admin/seasons', express.json({ limit: '16mb' }));
app.use(express.json());        
app.use((error, req, res, next) => {
  if (error.type === 'entity.too.large') {
    if (req.path.startsWith('/api/site-analytics/')) {
      return res.status(413).json({ error: 'Analytics request is too large' });
    }
    return res.status(413).json({ error: 'Request is too large. Each MMR screenshot must be 2 MB or less.' });
  }
  return next(error);
});

// Middleware
app.use(passport.initialize());
app.use(passport.session());

if(process.env.ENVIRONMENT  === 'PROD'){

  const frontendPath = '/var/www/dotawebsite'; // where you moved the build
  app.use(express.static(frontendPath));

  // Always serve index.html for React routes
  app.get(/^(?!\/api).*REMOVETHIS/, (req, res) => {
    res.sendFile(path.join(frontendPath, 'index.html'));
  });

}


// Serve static frontend
if(process.env.ENVIRONMENT === 'DEV')
  app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/api',routes); // Handles /auth/steam, /auth/steam/return, etc.


let liveNotifications;
const server=app.listen(SERVER_PORT, () => {
  console.log(`Server running at http://localhost:${SERVER_PORT}`);
  startLiveMatchNotifications(()=>liveMatchUpdates.publish(),{
    onUnavailable:()=>liveMatchUpdates.setAvailable(false),
  }).then(channel=>{
    if(stopping){channel.close();return;}
    liveNotifications=channel;liveMatchUpdates.setAvailable(true);
    console.log('Live match push channel ready.');
  }).catch(error=>{
    console.error(`Live match push channel unavailable (${error.code||error.message}); HTTP polling remains available.`);
  });
});

let stopping=false;
function shutdown() {
  if(stopping)return;stopping=true;
  liveMatchUpdates.close();
  liveNotifications?.close();
  server.close(()=>process.exit(0));
  setTimeout(()=>process.exit(0),3000).unref();
}
process.once('SIGINT',shutdown);
process.once('SIGTERM',shutdown);
