export async function bettingRequest(url,options) {
  const response=await fetch(url,options),data=await response.json();
  if(!response.ok){const error=new Error(data.error||'Request failed');error.code=data.code;throw error;}
  return data;
}
