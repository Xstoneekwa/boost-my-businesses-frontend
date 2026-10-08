"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { STRUCTURED_POC_KEY } from "@/lib/commercial/structured-discovery-contract";
export default function StartPoc(){
  const [busy,setBusy]=useState(false),[message,setMessage]=useState("");const router=useRouter();
  async function start(){setBusy(true);try{const response=await fetch("/api/instagram-dashboard/commercial/discovery/structured",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({authorizationKey:STRUCTURED_POC_KEY})});if(!response.ok)throw Error();setMessage("POC réservé. Aucun second lancement autorisé. Actualiser pour consulter les résultats.");router.refresh();}catch{setMessage("Lancement non confirmé. Actualiser avant toute autre action.");}finally{setBusy(false);}}
  return <div><button disabled={busy} onClick={start}>{busy?"Réservation…":"Lancer l’unique POC France — 15 maximum"}</button><p role="status">{message}</p></div>;
}
