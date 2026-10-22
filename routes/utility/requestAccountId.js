export function requestAccountId(req) {
  if(!req.isAuthenticated?.()||!req.user)return null;
  try {
    const id=BigInt(req.user.id)-76561197960265728n;
    return id>0n&&id<=BigInt(Number.MAX_SAFE_INTEGER)?id.toString():null;
  }catch{return null;}
}
