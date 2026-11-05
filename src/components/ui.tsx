'use client';
import type { ReactNode } from 'react';
import Decimal from 'decimal.js';
export async function api<T>(path:string, method='GET', body?:unknown):Promise<T> {
  const response=await fetch(`/api/${path}`,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,cache:'no-store'});
  const data=await response.json(); if(!response.ok) throw new Error(data.error || `操作失敗 (${response.status})`); return data;
}
export function Field({label,children,wide=false}:{label:string;children:ReactNode;wide?:boolean}) { return <label className={`field ${wide?'wide':''}`}><span>{label}</span>{children}</label> }
export function Empty({children}:{children:ReactNode}) { return <div className="empty">{children}</div> }
export function Badge({children,tone=''}:{children:ReactNode;tone?:string}) { return <span className={`badge ${tone}`}>{children}</span> }
export function money(value:string|null|undefined) {if(value==null)return '—'; const [whole,fraction]=new Decimal(value).toFixed(2,Decimal.ROUND_HALF_UP).split('.');return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g,',')}.${fraction}`;}
export function localDate() { const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
