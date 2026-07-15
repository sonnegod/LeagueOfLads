// config/passport.js
import passport from 'passport';
import { Strategy as SteamStrategy } from 'passport-steam';
import { getSteamAccountId, steamId64ToAccountId } from '../utils/steamIds.js';

import dotenv from 'dotenv';
dotenv.config();

const STEAM_API_KEY = process.env.STEAM_API_KEY; // Replace with your real API key

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => {
  try {
    done(null, { ...obj, accountId: getSteamAccountId(obj) });
  } catch (err) {
    done(err);
  }
});

let returnURL = '';
let realmURL = '';
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
  try {
    profile.accountId = steamId64ToAccountId(profile.id);
    return done(null, profile);
  } catch (err) {
    return done(err);
  }
}));
