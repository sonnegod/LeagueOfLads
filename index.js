// index.js
import express from 'express';
import session from 'express-session';
import passport from 'passport';
import path from 'path';
import { fileURLToPath } from 'url';

import './config/passport.js';              
import routes from './routes/routes.js';

import cors from 'cors';

import dotenv from 'dotenv';
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const SERVER_PORT = process.env.SERVER_PORT || 3000;

app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true
}));

// Session setup
app.use(session({
  secret: 'your-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // must be false for localhost unless using HTTPS
    httpOnly: true,
	maxAge: 3600000
  }
}));

app.use(express.json());        

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


app.listen(SERVER_PORT, () => {
  console.log(`Server running at http://localhost:${SERVER_PORT}`);
});
