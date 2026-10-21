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

import * as Arrow from 'apache-arrow';
const { BN, bigNumToNumber, bigNumToBigInt } = Arrow.util;

/** Little-endian two's complement words for `value` in a `bitWidth`-bit integer. */
const toWords = (value: bigint, bitWidth: number) => {
    const words = new Uint32Array(bitWidth / 32);
    let x = BigInt.asUintN(bitWidth, value);
    for (let i = 0; i < words.length; i++) {
        words[i] = Number(x & BigInt(0xFFFFFFFF));
        x >>= BigInt(32);
    }
    return words;
};

/**
 * A decimal value read from a vector. `BN.decimal()` is renamed in the
 * minified UMD bundles, so tests go through the public API instead.
 */
const decimal = (value: bigint, bitWidth = 128, scale = 0) =>
    Arrow.makeVector({ type: new Arrow.Decimal(scale, 76, bitWidth), data: toWords(value, bitWidth) }).get(0)!;

describe(`BN`, () => {
    test(`to detect signed numbers, unsigned numbers and decimals`, () => {
        // SignedBigNum
        const i = new BN(new Int32Array([5, 0]));
        expect(i.signed).toBe(true);

        // UnsignedBigNum
        const u = new BN(new Uint32Array([5, 0]));
        expect(u.signed).toBe(false);

        // DecimalBigNum
        const d = new BN(new Uint16Array([1, 2, 3, 4, 5, 6, 7, 8]));
        expect(d.signed).toBe(true);
    });

    test(`toString for signed numbers`, () => {
        const i1 = new BN(new Int32Array([5, 33]), true);
        expect(i1.toString()).toBe('141733920773');

        const i2 = new BN(new Int32Array([0xFFFFFFFF, 0xFFFFFFFF]), true);
        expect(i2.toString()).toBe('-1');

        const i3 = new BN(new Int32Array([0x11111111, 0x11111111, 0x11111111]), true);
        expect(i3.toString()).toBe('5281877500950955839569596689');

        const i4 = new BN(new Int16Array([0xFFFF, 0xFFFF]), true);
        expect(i4.toString()).toBe('-1');

        const i5 = new BN(new Int32Array([0xFFFFFFFE, 0xFFFFFFFF, 0xFFFFFFFF]), true);
        expect(i5.toString()).toBe('-2');
    });

    test(`toString for unsigned numbers`, () => {
        const u1 = new BN(new Uint32Array([5, 33]), false);
        expect(u1.toString()).toBe('141733920773');

        const u2 = new BN(new Uint32Array([0xFFFFFFFF, 0xFFFFFFFF]), false);
        expect(u2.toString()).toBe('18446744073709551615');

        const u3 = new BN(new Uint32Array([0x11111111, 0x11111111, 0x11111111]), false);
        expect(u3.toString()).toBe('5281877500950955839569596689');

        const u4 = new BN(new Uint16Array([0xFFFF, 0xFFFF]), false);
        expect(u4.toString()).toBe('4294967295');
    });

    test(`toString for decimals`, () => {
        const toDecimal = (val: Uint32Array) => {
            const builder = Arrow.makeBuilder({
                type: new Arrow.Decimal(0, 38),
                nullValues: []
            });
            builder.append(val);
            return <Arrow.Type.Decimal><any>builder.finish().toVector().get(0);
        };

        const d2 = toDecimal(new Uint32Array([0xFFFFFFFE, 0xFFFFFFFF, 0xFFFFFFFF, 0xFFFFFFFF]));
        expect(d2.toString()).toBe('-2');

        const d3 = toDecimal(new Uint32Array([0x00000000, 0x00000000, 0x00000000, 0x80000000]));
        expect(d3.toString()).toBe('-170141183460469231731687303715884105728');

        const d4 = toDecimal(new Uint32Array([0x9D91E773, 0x4BB90CED, 0xAB2354CC, 0x54278E9B]));
        expect(d4.toString()).toBe('111860543658909349380118287427608635251');
    });

    test(`valueOf for decimal numbers`, () => {
        const n1 = new BN(new Uint32Array([0x00000001, 0x00000000, 0x00000000, 0x00000000]), false);
        expect(n1.valueOf()).toBe(1);
        const n2 = new BN(new Uint32Array([0xFFFFFFFE, 0xFFFFFFFF, 0xFFFFFFFF, 0xFFFFFFFF]), true);
        expect(n2.valueOf()).toBe(-2);
        const n3 = new BN(new Uint32Array([0xFFFFFFFF, 0xFFFFFFFF, 0xFFFFFFFF, 0xFFFFFFFF]), true);
        expect(n3.valueOf()).toBe(-1);
        const n4 = new BN(new Uint32Array([0xFFFFFFFF, 0xFFFFFFFF, 0xFFFFFFFF, 0xFFFFFFFF]), true);
        expect(n4.valueOf(1)).toBe(-0.1);
        // const n5 = new BN(new Uint32Array([0x00000000, 0x00000000, 0x00000000, 0x80000000]), false);
        // expect(n5.valueOf()).toBe(1.7014118346046923e+38);
        // const n6 = new BN(new Uint32Array([0x00000000, 0x00000000, 0x00000000, 0x80000000]), false);
        // expect(n6.valueOf(1)).toBe(1.7014118346046923e+37);
    });

    test(`bigNumToNumber`, () => {
        const n1 = new BN(new Uint32Array([3, 2, 1, 0]));
        expect(() => bigNumToNumber(n1)).toThrow('18446744082299486211');
        /* eslint-disable no-loss-of-precision */
        expect(bigNumToNumber(n1, 10)).toBeCloseTo(1844674408.2299486);
        expect(bigNumToNumber(n1, 15)).toBeCloseTo(18446.744082299486);
        expect(bigNumToNumber(n1, 20)).toBeCloseTo(0.18446744082299486);
        expect(bigNumToNumber(n1, 25)).toBeCloseTo(0.0000018446744082299486);
        /* eslint-enable no-loss-of-precision */
    });

    test(`toString for 256-bit decimals`, () => {
        const values = [
            BigInt(0),
            BigInt(1234),
            BigInt(-1234),
            BigInt('12345678901234567890'),
            BigInt(2) ** BigInt(130),
            -(BigInt(2) ** BigInt(200)),
            BigInt(2) ** BigInt(255) - BigInt(1),
            -(BigInt(2) ** BigInt(255)),
        ];
        for (const value of values) {
            expect(decimal(value, 256).toString()).toBe(`${value}`);
        }
    });

    test(`toString for Decimal256 vector values`, () => {
        const type = new Arrow.Decimal(0, 76, 256);
        const values = [BigInt(1234), BigInt(-1234), BigInt(2) ** BigInt(130)];
        const data = new Uint32Array(values.length * 8);
        for (const [i, value] of values.entries()) {
            data.set(toWords(value, 256), i * 8);
        }
        const vector = Arrow.makeVector({ type, data });
        expect([...vector].map((x) => `${x}`)).toEqual(values.map((x) => `${x}`));
    });

    test(`valueOf for 256-bit decimals`, () => {
        const decimal256 = (value: bigint) => decimal(value, 256);
        expect(decimal256(BigInt(1234)).valueOf()).toBe(1234);
        expect(decimal256(BigInt(-1234)).valueOf()).toBe(-1234);
        expect(decimal256(BigInt(1999)).valueOf(2)).toBe(19.99);
        expect(decimal256(BigInt(-1999)).valueOf(2)).toBe(-19.99);
        expect(decimal256(BigInt(-5)).valueOf(3)).toBe(-0.005);
        expect(decimal256(BigInt(2) ** BigInt(130)).valueOf(30)).toBeCloseTo(1361129467.68);
        expect(() => decimal256(BigInt(2) ** BigInt(130)).valueOf()).toThrow('1361129467683753853853498429727072845824');
    });

    test(`valueOf with a negative scale`, () => {
        expect(decimal(BigInt(123)).valueOf(-2)).toBe(12300);
        expect(decimal(BigInt(-123)).valueOf(-2)).toBe(-12300);
        expect(decimal(BigInt(0)).valueOf(-2)).toBe(0);
        expect(decimal(BigInt(123), 128, -2).valueOf()).toBe(12300);
        expect(() => decimal(BigInt(2) ** BigInt(60)).valueOf(-2)).toThrow('115292150460684697600');
    });

    test(`negative 64-bit decimals`, () => {
        const d = decimal(BigInt(-1), 64);
        expect(d.toString()).toBe('-1');
        expect(d.toString(2)).toBe('-0.01');
        expect(d.valueOf()).toBe(-1);
        expect(d.valueOf(10)).toBe(-1e-10);

        const type = new Arrow.Decimal(2, 18, 64);
        const vector = Arrow.makeVector({ type, data: toWords(BigInt(-1999), 64) });
        expect(`${vector.get(0)}`).toBe('-19.99');
        expect(vector.get(0)!.unscaled).toBe(BigInt(-1999));
        expect(vector.get(0)!.valueOf()).toBe(-19.99);
    });

    test(`toString with a scale`, () => {
        expect(decimal(BigInt(1999)).toString(2)).toBe('19.99');
        expect(decimal(BigInt(-1999)).toString(2)).toBe('-19.99');
        expect(decimal(BigInt(100)).toString(2)).toBe('1.00');
        expect(decimal(BigInt(5)).toString(3)).toBe('0.005');
        expect(decimal(BigInt(-5)).toString(3)).toBe('-0.005');
        expect(decimal(BigInt(0)).toString(5)).toBe('0.00000');
        expect(decimal(BigInt(1234)).toString(0)).toBe('1234');
        expect(decimal(BigInt(123)).toString(-2)).toBe('12300');
        expect(decimal(BigInt(0)).toString(-2)).toBe('0');
        expect(decimal(BigInt(-1999)).toString(Number.NaN)).toBe('-1999');
        expect(decimal(BigInt('123456789012345678901234567890')).toString(10)).toBe('12345678901234567890.1234567890');
        expect(decimal(-(BigInt(2) ** BigInt(255)), 256).toString(76))
            .toBe('-5.7896044618658097711785492504343953926634992332820282019728792003956564819968');
    });

    test(`decimals with a scale`, () => {
        const d = decimal(BigInt(-1999), 128, 2);
        expect(d.scale).toBe(2);
        expect(d.unscaled).toBe(BigInt(-1999));
        expect(`${d}`).toBe('-19.99');
        expect(d + '').toBe('-19.99');
        expect(+d).toBe(-19.99);
        expect(JSON.stringify(d)).toBe('"-19.99"');
    });

    test(`decimals without a scale are unscaled`, () => {
        const d = new BN(toWords(BigInt(-1999), 128));
        expect(d.scale).toBeUndefined();
        expect(`${d}`).toBe('-1999');
        expect(d[Symbol.toPrimitive]('default')).toBe(BigInt(-1999));
        expect(JSON.stringify(d)).toBe('"-1999"');
    });

    test(`bigNumToBigInt`, () => {
        expect(bigNumToBigInt(decimal(BigInt(-2), 128))).toBe(BigInt(-2));
        expect(bigNumToBigInt(decimal(BigInt(2) ** BigInt(130), 256))).toBe(BigInt(2) ** BigInt(130));
        expect(bigNumToBigInt(new BN(new Uint32Array([0x11111111, 0x11111111, 0x11111111]), false)))
            .toBe(BigInt('5281877500950955839569596689'));
        expect(new BN(toWords(BigInt(-2), 128), true)[Symbol.toPrimitive]('default')).toBe(BigInt(-2));
        // 64-bit value at an offset that is not 8-byte aligned
        const unaligned = new Uint32Array([0, 5, 33]).subarray(1);
        expect(bigNumToBigInt(new BN(unaligned, false))).toBe(BigInt(141733920773));
    });
});
