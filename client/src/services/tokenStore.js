// Access token storage. localStorage keeps the user signed in across tabs and reloads for
// the life of the (short) token; the server remains the authority on whether it is valid.
const KEY = 'shieldshare.accessToken';

export const tokenStore = {
  get() {
    try {
      return window.localStorage.getItem(KEY);
    } catch {
      return null;
    }
  },
  set(token) {
    try {
      window.localStorage.setItem(KEY, token);
    } catch {
      /* storage unavailable: the session lasts until reload */
    }
  },
  clear() {
    try {
      window.localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  },
};
