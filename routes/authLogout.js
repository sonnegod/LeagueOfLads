import {requestAccountId} from './utility/requestAccountId.js';

export function createLogoutHandler({removeWaiting}) {
  return (req, res, next) => {
    // Passport clears req.user, so remove the authenticated account's waiting
    // entry before ending its session. Never accept an account ID from input.
    try {
      const id = requestAccountId(req);
      if (id) removeWaiting(id);
    } catch (error) {return next(error);}
    return req.logout(error => {
      if (error) return next(error);
      const finish = () => {res.clearCookie('connect.sid'); res.redirect('/');};
      if (!req.session?.destroy) return finish();
      return req.session.destroy(error => error ? next(error) : finish());
    });
  };
}
