import React, { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';

export default function ScanPage({ locale }){
  const [scanned, setScanned] = useState(null);

  useEffect(()=>{
    let mounted = true;
    (async ()=>{
      try {
        const { Html5Qrcode } = await import('html5-qrcode');
        const html5QrCode = new Html5Qrcode("reader");
        function onScanSuccess(decodedText, decodedResult){
          if(!mounted) return;
          setScanned(decodedText);
          html5QrCode.stop().catch(()=>{});
        }
        html5QrCode.start({ facingMode: "environment" }, { fps:10, qrbox:250 }, onScanSuccess)
          .catch(err=> console.log('scan start err', err));
      } catch(e){
        console.error('scanner load err', e);
      }
    })();
    return ()=> mounted = false;
  },[]);

  useEffect(()=>{
    if (!scanned) return;
    fetch('/api/public_item_by_sku?sku=' + encodeURIComponent(scanned)).then(r=>r.json()).then(data=>{
      if(data && data.sku) setScanned(data);
    }).catch(()=>{});
  },[scanned]);

  return (
    <div>
      <h2>{t(locale,'scan')}</h2>
      <div id="reader" style={{width:'100%'}}></div>
      <div style={{marginTop:12}}>
        {scanned ? (
          typeof scanned === 'string' ? <div>Scanned: {scanned}</div> :
          <div>
            <div style={{fontWeight:700}}>{scanned.name}</div>
            <div className="small">SKU: {scanned.sku}</div>
            <div className="small">Qty: {scanned.qty}</div>
            {scanned.modelUrl && <model-viewer src={scanned.modelUrl} alt="3D" style={{width:'100%',height:300}} camera-controls auto-rotate></model-viewer>}
          </div>
        ) : <div className="small">Point camera at a barcode or QR with SKU</div>}
      </div>
      <script type="module" src="https://unpkg.com/@google/model-viewer/dist/model-viewer.min.js"></script>
    </div>
  );
}
