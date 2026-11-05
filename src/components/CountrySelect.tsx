'use client';

import { COUNTRIES } from '@/lib/countries';

export default function CountrySelect({
  value, onChange, label = '國家', required = false, disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  return (
    <select aria-label={label} value={value} required={required} disabled={disabled} onChange={event => onChange(event.target.value)}>
      <option value="">請選擇國家</option>
      {COUNTRIES.map(country => <option key={country.code} value={country.code}>{country.code} · {country.name}</option>)}
    </select>
  );
}
