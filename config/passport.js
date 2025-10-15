// config/passport.js
import passport from 'passport';
import { Strategy as SteamStrategy } from 'passport-steam';

import dotenv from 'dotenv';
dotenv.config();

const STEAM_API_KEY = process.env.STEAM_API_KEY; // Replace with your real API key

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

const returnURL = '';
const realmURL = '';
if(process.env.ENVIRONMENT === 'DEV'){
  returnURL = `http://localhost:${process.env.SERVER_PORT}/api/auth/steam/return`;
  realmURL = `http://localhost:${process.env.SERVER_PORT}/`;
}
else if(process.env.ENVIRONMENT === 'PROD'){
  returnURL = `https://www.leagueoflads.com/api/auth/steam/return`;
  realmURL = `https://www.leagueoflads.com/`;
}

passport.use(new SteamStrategy({
  returnURL: returnURL,
  realm: realmURL,
  apiKey: STEAM_API_KEY
}, (identifier, profile, done) => {

  return done(null, profile);
}));
