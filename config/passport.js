// config/passport.js
import passport from 'passport';
import { Strategy as SteamStrategy } from 'passport-steam';

import dotenv from 'dotenv';
dotenv.config();

const STEAM_API_KEY = process.env.STEAM_API_KEY; // Replace with your real API key

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(new SteamStrategy({
  returnURL: `http://localhost:${process.env.SERVER_PORT}/api/auth/steam/return`,//https://www.leagueoflads.com for both
  realm: `http://localhost:${process.env.SERVER_PORT}/`,
  apiKey: STEAM_API_KEY
}, (identifier, profile, done) => {

  return done(null, profile);
}));
