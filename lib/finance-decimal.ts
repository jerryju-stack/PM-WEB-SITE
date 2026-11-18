import type {FixedDecimal} from './finance-contracts.ts';

const gcd=(a:bigint,b:bigint):bigint=>{a=a<0n?-a:a;b=b<0n?-b:b;while(b){[a,b]=[b,a%b];}return a||1n;};
/** Exact rational arithmetic. Currency is rounded only at the presentation boundary. */
export class Decimal {
  n:bigint; d:bigint;
  constructor(n:bigint,d=1n) {
    if(!d)throw new Error('zero_denominator');
    if(d<0n){n=-n;d=-d;}const g=gcd(n,d);this.n=n/g;this.d=d/g;
  }
  static from(value:string|number|FixedDecimal):Decimal {
    if(typeof value==='object')return new Decimal(BigInt(value.coefficient),10n**BigInt(value.scale));
    const m=/^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(String(value));
    if(!m||String(value).length>160||Math.abs(Number(m[4]??0))>100)throw new Error('invalid_decimal');
    const n=BigInt((m[1]==='-'?'-':'')+m[2]+(m[3]??'')),scale=(m[3]?.length??0)-Number(m[4]??0);
    return scale<0?new Decimal(n*10n**BigInt(-scale)):new Decimal(n,10n**BigInt(scale));
  }
  add(b:Decimal){return new Decimal(this.n*b.d+b.n*this.d,this.d*b.d);}
  sub(b:Decimal){return this.add(b.neg());}
  mul(b:Decimal){return new Decimal(this.n*b.n,this.d*b.d);}
  div(b:Decimal){return new Decimal(this.n*b.d,this.d*b.n);}
  neg(){return new Decimal(-this.n,this.d);}
  abs(){return this.n<0n?this.neg():this;}
  pow(n:number){if(!Number.isInteger(n)||n<0||n>200)throw new Error('invalid_period');return new Decimal(this.n**BigInt(n),this.d**BigInt(n));}
  cmp(b:Decimal){const v=this.n*b.d-b.n*this.d;return v<0n?-1:v>0n?1:0;}
  number(){return Number(this.n)/Number(this.d);}
  text(scale=18):string {
    const factor=10n**BigInt(scale),v=(this.n<0n?-this.n:this.n)*factor;
    const rounded=v/this.d+(v%this.d*2n>=this.d?1n:0n),digits=rounded.toString().padStart(scale+1,'0');
    return (this.n<0n&&rounded?'-':'')+(scale?digits.slice(0,-scale)+'.'+digits.slice(-scale):digits);
  }
  exact(){return {numerator:this.n.toString(),denominator:this.d.toString()};}
}
export const ZERO=Decimal.from(0),ONE=Decimal.from(1);
export const sum=(items:Decimal[])=>items.reduce((a,b)=>a.add(b),ZERO);
