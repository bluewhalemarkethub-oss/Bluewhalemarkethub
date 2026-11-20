import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

interface QrCodeCanvasProps {
  value: string;
  size?: number;
  label?: string;
}

export function QrCodeCanvas({ value, size = 180, label = 'QR Code' }: QrCodeCanvasProps) {
  const [dataUrl, setDataUrl] = useState<string>('');
  const [error, setError] = useState<string>('');

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(value, {
      width: size,
      margin: 2,
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
    })
      .then((url) => {
        if (active) {
          setDataUrl(url);
          setError('');
        }
      })
      .catch(() => {
        if (active) setError('Unable to generate QR code');
      });

    return () => {
      active = false;
    };
  }, [value, size]);

  if (error) {
    return (
      <div
        style={{ width: size, height: size }}
        className="flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-xs text-slate-500 p-4 text-center"
      >
        {error}
      </div>
    );
  }

  if (!dataUrl) {
    return (
      <div
        style={{ width: size, height: size }}
        className="animate-pulse rounded-lg bg-slate-200 dark:bg-slate-800"
      />
    );
  }

  return (
    <div className="inline-flex flex-col items-center p-3 bg-white rounded-xl border border-slate-200">
      <img
        src={dataUrl}
        alt={label}
        width={size}
        height={size}
        referrerPolicy="no-referrer"
        className="block rounded"
      />
    </div>
  );
}
