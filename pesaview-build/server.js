import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();
const app = express();
app.use(express.json());
app.use(express.urlencoded({extended:true}));
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(__dirname));

const cfg = () => ({
  env: process.env.MPESA_ENV || 'sandbox',
  key: process.env.MPESA_CONSUMER_KEY,
  secret: process.env.MPESA_CONSUMER_SECRET,
  shortcode: process.env.MPESA_SHORTCODE,
  passkey: process.env.MPESA_PASSKEY,
  callback: process.env.MPESA_CALLBACK_URL
});
const base = () => cfg().env === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke';
const tokenCache = { token:null, expires:0 };

async function accessToken(){
  const c=cfg();
  if(!c.key || !c.secret) throw new Error('M-Pesa credentials are not configured on the server.');
  if(tokenCache.token && Date.now()<tokenCache.expires) return tokenCache.token;
  const auth=Buffer.from(`${c.key}:${c.secret}`).toString('base64');
  const r=await fetch(`${base()}/oauth/v1/generate?grant_type=client_credentials`,{headers:{Authorization:`Basic ${auth}`}});
  const d=await r.json();
  if(!r.ok || !d.access_token) throw new Error(d.errorMessage || 'Could not obtain Daraja access token.');
  tokenCache.token=d.access_token; tokenCache.expires=Date.now()+Math.max(60,(Number(d.expires_in)||3599)-60)*1000;
  return tokenCache.token;
}
function timestamp(){ const d=new Date(); const p=n=>String(n).padStart(2,'0'); return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; }

app.post('/api/mpesa/stkpush', async (req,res)=>{
  try{
    const {phone, amount, accountReference='PesaView', transactionDesc='PesaView payment'}=req.body;
    if(!phone || !amount) return res.status(400).json({error:'Phone and amount are required.'});
    const c=cfg();
    if(!c.shortcode || !c.passkey || !c.callback) return res.status(500).json({error:'M-Pesa server configuration is incomplete.'});
    const msisdn=String(phone).replace(/^0/,'254').replace(/^\+/,'');
    if(!/^2547\d{8}$/.test(msisdn)) return res.status(400).json({error:'Use a valid Kenyan Safaricom number, e.g. 2547XXXXXXXX.'});
    const ts=timestamp();
    const password=Buffer.from(`${c.shortcode}${c.passkey}${ts}`).toString('base64');
    const body={BusinessShortCode:c.shortcode,Password:password,Timestamp:ts,TransactionType:'CustomerPayBillOnline',Amount:Math.round(Number(amount)),PartyA:msisdn,PartyB:c.shortcode,PhoneNumber:msisdn,CallBackURL:c.callback,AccountReference:String(accountReference).slice(0,12),TransactionDesc:String(transactionDesc).slice(0,20)};
    const r=await fetch(`${base()}/mpesa/stkpush/v1/processrequest`,{method:'POST',headers:{Authorization:`Bearer ${await accessToken()}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
    const d=await r.json();
    if(!r.ok) return res.status(r.status).json(d);
    res.json(d);
  }catch(e){res.status(500).json({error:e.message});}
});

app.post('/api/mpesa/callback',(req,res)=>{
  // Always acknowledge Safaricom quickly. Persist/validate this payload in your database in production.
  console.log('M-Pesa callback received:',JSON.stringify(req.body));
  res.json({ResultCode:0,ResultDesc:'Accepted'});
});

app.get('/api/health',(req,res)=>res.json({ok:true,mpesaConfigured:Boolean(process.env.MPESA_CONSUMER_KEY&&process.env.MPESA_CONSUMER_SECRET&&process.env.MPESA_SHORTCODE&&process.env.MPESA_PASSKEY&&process.env.MPESA_CALLBACK_URL)}));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'pesaview.html')));
const port=process.env.PORT||3000;
app.listen(port,()=>console.log(`PesaView running on http://localhost:${port}`));
