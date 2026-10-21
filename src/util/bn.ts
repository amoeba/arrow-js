// Licensed to the Apache Software Foundation (ASF) under one
// or more contributor license agreements.  See the NOTICE file
// distributed with this work for additional information
// regarding copyright ownership.  The ASF licenses this file
// to you under the Apache License, Version 2.0 (the
// "License"); you may not use this file except in compliance
// with the License.  You may obtain a copy of the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied.  See the License for the
// specific language governing permissions and limitations
// under the License.

import { ArrayBufferViewInput, toArrayBufferView } from './buffer.js';
import { TypedArray, TypedArrayConstructor } from '../interfaces.js';
import { BigIntArray, BigIntArrayConstructor } from '../interfaces.js';
import { bigIntToNumber } from './bigint.js';

/** @ignore */
export const isArrowBigNumSymbol = Symbol.for('isArrowBigNum');

/** @ignore */ type BigNumArray = IntArray | UintArray;
/** @ignore */ type IntArray = Int8Array | Int16Array | Int32Array;
/** @ignore */ type UintArray = Uint8Array | Uint16Array | Uint32Array | Uint8ClampedArray;

/** @ignore */
function BigNum(this: any, x: any, ...xs: any) {
    if (xs.length === 0) {
        return Object.setPrototypeOf(toArrayBufferView(this['TypedArray'], x), this.constructor.prototype);
    }
    return Object.setPrototypeOf(new this['TypedArray'](x, ...xs), this.constructor.prototype);
}

BigNum.prototype[isArrowBigNumSymbol] = true;
BigNum.prototype.toJSON = function <T extends BN<BigNumArray>>(this: T) { return bigNumToString(this, this['scale']); };
BigNum.prototype.valueOf = function <T extends BN<BigNumArray>>(this: T, scale = this['scale']) { return bigNumToNumber(this, scale); };
BigNum.prototype.toString = function <T extends BN<BigNumArray>>(this: T, scale = this['scale']) { return bigNumToString(this, scale); };
BigNum.prototype[Symbol.toPrimitive] = function <T extends BN<BigNumArray>>(this: T, hint: 'string' | 'number' | 'default' = 'default') {
    const scale = this['scale'];
    switch (hint) {
        case 'number': return bigNumToNumber(this, scale);
        case 'string': return bigNumToString(this, scale);
        // Scaled decimals can't be represented as a bigint, so use the string
        case 'default': return typeof scale === 'number' ? bigNumToString(this, scale) : bigNumToBigInt(this);
    }
    // @ts-ignore
    return bigNumToString(this, scale);
};

/** @ignore */
type TypedArrayConstructorArgs =
    [number | void] |
    [Iterable<number> | Iterable<bigint>] |
    [ArrayBufferLike, number | void, number | void];

/** @ignore */
function SignedBigNum(this: any, ...args: TypedArrayConstructorArgs) { return BigNum.apply(this, args); }
/** @ignore */
function UnsignedBigNum(this: any, ...args: TypedArrayConstructorArgs) { return BigNum.apply(this, args); }
/** @ignore */
function DecimalBigNum(this: any, ...args: TypedArrayConstructorArgs) { return BigNum.apply(this, args); }

Object.setPrototypeOf(SignedBigNum.prototype, Object.create(Int32Array.prototype));
Object.setPrototypeOf(UnsignedBigNum.prototype, Object.create(Uint32Array.prototype));
Object.setPrototypeOf(DecimalBigNum.prototype, Object.create(Uint32Array.prototype));
Object.assign(SignedBigNum.prototype, BigNum.prototype, { 'constructor': SignedBigNum, 'signed': true, 'TypedArray': Int32Array, 'BigIntArray': BigInt64Array });
Object.assign(UnsignedBigNum.prototype, BigNum.prototype, { 'constructor': UnsignedBigNum, 'signed': false, 'TypedArray': Uint32Array, 'BigIntArray': BigUint64Array });
Object.assign(DecimalBigNum.prototype, BigNum.prototype, { 'constructor': DecimalBigNum, 'signed': true, 'TypedArray': Uint32Array, 'BigIntArray': BigUint64Array });
Object.defineProperty(DecimalBigNum.prototype, 'unscaled', {
    get<T extends BN<BigNumArray>>(this: T) { return bigNumToBigInt(this); }
});

/** @ignore */
const decimalPrototypesByScale = new Map<number, any>();

/** @ignore */
function decimalPrototype(scale: number) {
    let proto = decimalPrototypesByScale.get(scale);
    if (!proto) {
        // One shared prototype per scale lets values carry their scale without a per-value property
        proto = Object.create(DecimalBigNum.prototype, { 'scale': { value: scale } });
        decimalPrototypesByScale.set(scale, proto);
    }
    return proto;
}

/** @ignore */
export function bigNumToNumber<T extends BN<BigNumArray>>(bn: T, scale?: number) {
    const number = bigNumToBigInt(bn);
    if (typeof scale === 'number' && scale > 0) {
        const negative = number < BigInt(0);
        const denominator = BigInt('1'.padEnd(scale + 1, '0'));
        const quotient = number / denominator;
        const remainder = negative ? -(number % denominator) : number % denominator;
        const integerPart = bigIntToNumber(quotient);
        const fractionPart = `${remainder}`.padStart(scale, '0');
        const sign = negative && integerPart === 0 ? '-' : '';
        return +`${sign}${integerPart}.${fractionPart}`;
    }
    return bigIntToNumber(number);
}

/** @ignore */
export function bigNumToString<T extends BN<BigNumArray>>(a: T, scale?: number): string {
    const number = bigNumToBigInt(a);
    if (typeof scale === 'number' && scale > 0) {
        const negative = number < BigInt(0);
        // Pad so there is always at least one digit before the decimal point
        const digits = `${negative ? -number : number}`.padStart(scale + 1, '0');
        return `${negative ? '-' : ''}${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
    }
    // A negative scale multiplies the unscaled value by 10^-scale
    if (typeof scale === 'number' && scale < 0) {
        return number === BigInt(0) ? '0' : `${number}${'0'.repeat(-scale)}`;
    }
    return `${number}`;
}

/** @ignore */
export function bigNumToBigInt<T extends BN<BigNumArray>>(a: T): bigint {
    const { buffer, byteOffset, byteLength, 'signed': signed } = a;
    // use BigInt native implementation
    if (byteLength === 8 && byteOffset % 8 === 0) {
        return new (signed ? BigInt64Array : BigUint64Array)(buffer, byteOffset, 1)[0];
    }
    // Accumulate little-endian words from most to least significant. Use
    // 32-bit words when aligned, otherwise fall back to 16-bit words.
    const words = byteOffset % 4 === 0 && byteLength % 4 === 0
        ? new Uint32Array(buffer, byteOffset, byteLength / 4)
        : new Uint16Array(buffer, byteOffset, byteLength / 2);
    const wordBits = BigInt(words.BYTES_PER_ELEMENT * 8);
    let number = BigInt(0);
    for (let i = words.length; --i >= 0;) {
        number = (number << wordBits) | BigInt(words[i]);
    }
    return signed ? BigInt.asIntN(byteLength * 8, number) : number;
}

/** @ignore */
export class BN<T extends BigNumArray> {
    /** @nocollapse */
    public static new<T extends BigNumArray>(num: T, isSigned?: boolean): (T & BN<T>) {
        switch (isSigned) {
            case true: return new (<any>SignedBigNum)(num) as (T & BN<T>);
            case false: return new (<any>UnsignedBigNum)(num) as (T & BN<T>);
        }
        switch (num.constructor) {
            case Int8Array:
            case Int16Array:
            case Int32Array:
            case BigInt64Array:
                return new (<any>SignedBigNum)(num) as (T & BN<T>);
        }
        if (num.byteLength === 16) {
            return new (<any>DecimalBigNum)(num) as (T & BN<T>);
        }
        return new (<any>UnsignedBigNum)(num) as (T & BN<T>);
    }
    /** @nocollapse */
    public static signed<T extends IntArray>(num: T): (T & BN<T>) {
        return new (<any>SignedBigNum)(num) as (T & BN<T>);
    }
    /** @nocollapse */
    public static unsigned<T extends UintArray>(num: T): (T & BN<T>) {
        return new (<any>UnsignedBigNum)(num) as (T & BN<T>);
    }
    /** @nocollapse */
    public static decimal<T extends UintArray>(num: T, scale?: number): (T & BN<T>) {
        if (typeof scale === 'number') {
            return Object.setPrototypeOf(toArrayBufferView(Uint32Array, num), decimalPrototype(scale)) as (T & BN<T>);
        }
        return new (<any>DecimalBigNum)(num) as (T & BN<T>);
    }
    constructor(num: T, isSigned?: boolean) {
        return BN.new(num, isSigned) as any;
    }
}

/** @ignore */
export interface BN<T extends BigNumArray> extends TypedArrayLike<T> {

    new <T extends ArrayBufferViewInput>(buffer: T, signed?: boolean): T;

    readonly signed: boolean;
    /**
     * The decimal scale used by toString(), valueOf(), and toJSON() when no
     * scale is passed. Set on decimal values read from a vector.
     */
    readonly scale?: number;
    /**
     * The stored integer without the scale applied. Only defined for decimals.
     */
    readonly unscaled?: bigint;
    readonly TypedArray: TypedArrayConstructor<TypedArray>;
    readonly BigIntArray: BigIntArrayConstructor<BigIntArray>;

    [Symbol.toStringTag]:
    'Int8Array' |
    'Int16Array' |
    'Int32Array' |
    'Uint8Array' |
    'Uint16Array' |
    'Uint32Array' |
    'Uint8ClampedArray';

    /**
     * Convert the bytes to their base-10 representation for printing. The
     * value is formatted exactly as a decimal with `scale` fractional digits
     * (e.g. 1999 with scale 2 is "19.99"). Defaults to this value's scale.
     */
    toString(scale?: number): string;
    /**
     * Down-convert the bytes to a 53-bit precision number, dividing by
     * 10^scale. Defaults to this value's scale. Easy (and unsafe) way to
     * convert BN to number via `+bn_inst`
     */
    valueOf(scale?: number): number;
    /**
     * Return the base-10 string representation of the value, using this
     * value's scale, for JSON.stringify().
     */
    toJSON(): string;
    [Symbol.toPrimitive](hint?: any): number | string | bigint;
}

/** @ignore */
interface TypedArrayLike<T extends BigNumArray> {

    readonly length: number;
    readonly buffer: ArrayBuffer;
    readonly byteLength: number;
    readonly byteOffset: number;
    readonly BYTES_PER_ELEMENT: number;

    includes(searchElement: number, fromIndex?: number | undefined): boolean;
    copyWithin(target: number, start: number, end?: number | undefined): this;
    every(callbackfn: (value: number, index: number, array: T) => boolean, thisArg?: any): boolean;
    fill(value: number, start?: number | undefined, end?: number | undefined): this;
    filter(callbackfn: (value: number, index: number, array: T) => boolean, thisArg?: any): T;
    find(predicate: (value: number, index: number, obj: T) => boolean, thisArg?: any): number | undefined;
    findIndex(predicate: (value: number, index: number, obj: T) => boolean, thisArg?: any): number;
    forEach(callbackfn: (value: number, index: number, array: T) => void, thisArg?: any): void;
    indexOf(searchElement: number, fromIndex?: number | undefined): number;
    join(separator?: string | undefined): string;
    lastIndexOf(searchElement: number, fromIndex?: number | undefined): number;
    map(callbackfn: (value: number, index: number, array: T) => number, thisArg?: any): T;
    reduce(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: T) => number): number;
    reduce(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: T) => number, initialValue: number): number;
    reduce<U>(callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: T) => U, initialValue: U): U;
    reduceRight(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: T) => number): number;
    reduceRight(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: T) => number, initialValue: number): number;
    reduceRight<U>(callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: T) => U, initialValue: U): U;
    reverse(): T;
    set(array: ArrayLike<number>, offset?: number | undefined): void;
    slice(start?: number | undefined, end?: number | undefined): T;
    some(callbackfn: (value: number, index: number, array: T) => boolean, thisArg?: any): boolean;
    sort(compareFn?: ((a: number, b: number) => number) | undefined): this;
    subarray(begin: number, end?: number | undefined): T;
    toLocaleString(): string;
    entries(): IterableIterator<[number, number]>;
    keys(): IterableIterator<number>;
    values(): IterableIterator<number>;
}
