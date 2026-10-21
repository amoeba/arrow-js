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

import {
    Decimal, Field, List, Map_, Struct, Utf8, makeBuilder, makeTable, makeVector, tableFromIPC, tableToIPC, vectorFromArray
} from 'apache-arrow';

/** Little-endian two's complement words for each value, `bitWidth` bits per value. */
const toWords = (values: bigint[], bitWidth: number) => {
    const stride = bitWidth / 32;
    const words = new Uint32Array(values.length * stride);
    for (const [i, value] of values.entries()) {
        let x = BigInt.asUintN(bitWidth, value);
        for (let j = 0; j < stride; j++) {
            words[i * stride + j] = Number(x & BigInt(0xFFFFFFFF));
            x >>= BigInt(32);
        }
    }
    return words;
};

/** The largest precision each decimal bit width can represent. */
const maxPrecision: Record<number, number> = { 32: 9, 64: 18, 128: 38, 256: 76 };

const decimalVector = (values: bigint[], scale: number, bitWidth = 128) =>
    makeVector({ type: new Decimal(scale, maxPrecision[bitWidth], bitWidth), data: toWords(values, bitWidth) });

describe(`DecimalVector`, () => {
    describe(`get() values carry their scale`, () => {
        const value = decimalVector([BigInt(1999)], 2).get(0)!;

        test(`string and number conversions apply the scale`, () => {
            expect(`${value}`).toBe('19.99');
            expect(String(value)).toBe('19.99');
            expect(value.toString()).toBe('19.99');
            expect(value + '').toBe('19.99');
            expect(Number(value)).toBe(19.99);
            expect(+value).toBe(19.99);
            expect(value.valueOf()).toBe(19.99);
            expect(JSON.stringify(value)).toBe('"19.99"');
            expect(JSON.stringify({ value })).toBe('{"value":"19.99"}');
        });

        test(`the unscaled value is still available`, () => {
            expect(value.scale).toBe(2);
            expect(value.unscaled).toBe(BigInt(1999));
            expect(value.toString(0)).toBe('1999');
            expect(value.valueOf(0)).toBe(1999);
        });

        test(`values are still zero-copy Uint32Array views`, () => {
            expect(value).toBeInstanceOf(Uint32Array);
            expect([...value]).toEqual([1999, 0, 0, 0]);
        });

        test(`negative, scale 0, and 256-bit values`, () => {
            expect(`${decimalVector([BigInt(-5)], 2).get(0)}`).toBe('-0.05');
            expect(Number(decimalVector([BigInt(-5)], 2).get(0))).toBe(-0.05);
            expect(`${decimalVector([BigInt(1999)], 0).get(0)}`).toBe('1999');
            expect(decimalVector([BigInt(1999)], 0).get(0)! + '').toBe('1999');
            const big = decimalVector([-(BigInt(2) ** BigInt(200))], 10, 256).get(0)!;
            expect(`${big}`).toBe('-160693804425899027554196209234116260252220299378279.2835301376');
            expect(big.unscaled).toBe(-(BigInt(2) ** BigInt(200)));
        });

        test(`values can be appended to a column with the same type`, () => {
            const type = new Decimal(2, 5);
            const builder = makeBuilder({ type });
            builder.append(value);
            const copy = builder.finish().toVector();
            expect(`${copy.get(0)}`).toBe('19.99');
            expect(copy.indexOf(value)).toBe(0);
        });
    });

    test(`Vector.toString applies the scale`, () => {
        expect(decimalVector([BigInt(1999), BigInt(-5), BigInt(100)], 2).toString()).toBe('[19.99,-0.05,1.00]');
        expect(decimalVector([BigInt(1999)], 0).toString()).toBe('[1999]');
        expect(decimalVector([BigInt(2) ** BigInt(130)], 5, 256).toString()).toBe('[13611294676837538538534984297270728.45824]');
    });

    test(`Vector.toString prints nulls`, () => {
        const builder = makeBuilder({ type: new Decimal(2, 5), nullValues: [null] });
        builder.append(toWords([BigInt(1999)], 128));
        builder.append(null);
        expect(builder.finish().toVector().toString()).toBe('[19.99,]');
    });

    test(`Table.toString applies the scale`, () => {
        const table = makeTable({
            price: decimalVector([BigInt(1999), BigInt(-5)], 2),
            count: decimalVector([BigInt(7), BigInt(8)], 0),
        });
        expect(table.toString()).toBe('[\n  {"price": 19.99, "count": 7},\n  {"price": -0.05, "count": 8}\n]');
        expect(table.get(0)!.toString()).toBe('{"price": 19.99, "count": 7}');
    });

    test(`Table.toString applies the scale with other column types`, () => {
        const table = makeTable({
            name: vectorFromArray(['apple', 'pear']),
            price: decimalVector([BigInt(1999), BigInt(250)], 2),
            qty: new Int32Array([3, 4]),
        });
        expect(table.toString()).toBe('[\n  {"name": "apple", "price": 19.99, "qty": 3},\n  {"name": "pear", "price": 2.50, "qty": 4}\n]');
    });

    test(`Table.toString applies the scale to nested decimals`, () => {
        const type = new List(new Field('item', new Decimal(2, 5)));
        const builder = makeBuilder({ type });
        builder.append([toWords([BigInt(1999)], 128), toWords([BigInt(-5)], 128)]);
        const table = makeTable({ prices: builder.finish().toVector() });
        expect(table.toString()).toBe('[\n  {"prices": ["19.99","-0.05"]}\n]');
    });

    test(`Table.toString prints null decimals`, () => {
        const builder = makeBuilder({ type: new Decimal(2, 5), nullValues: [null] });
        builder.append(toWords([BigInt(1999)], 128));
        builder.append(null);
        const table = makeTable({ price: builder.finish().toVector() });
        expect(table.toString()).toBe('[\n  {"price": 19.99},\n  {"price": null}\n]');
    });

    test(`MapRow.toString applies the scale`, () => {
        const type = new Map_(new Field('entries', new Struct([
            new Field('key', new Utf8(), false),
            new Field('value', new Decimal(2, 5)),
        ])));
        const builder = makeBuilder({ type });
        builder.append(new Map([['a', toWords([BigInt(1999)], 128)]]) as any);
        expect(`${builder.finish().toVector().get(0)}`).toBe('{"a": 19.99}');
    });

    test(`MapRow.toString applies the scale to keys`, () => {
        const type = new Map_(new Field('entries', new Struct([
            new Field('key', new Decimal(2, 5), false),
            new Field('value', new Utf8()),
        ])));
        const builder = makeBuilder({ type });
        builder.append(new Map([[toWords([BigInt(1999)], 128), 'sale']]) as any);
        expect(`${builder.finish().toVector().get(0)}`).toBe('{19.99: "sale"}');
    });

    describe(`IPC round trip`, () => {
        for (const bitWidth of [32, 64, 128, 256]) {
            for (const format of ['stream', 'file'] as const) {
                test(`Decimal${bitWidth} (${format})`, () => {
                    // Include the largest and smallest values the precision allows
                    const max = BigInt('9'.repeat(maxPrecision[bitWidth]));
                    const values = [BigInt(1999), BigInt(-5), max, -max];
                    const source = makeTable({ d: decimalVector(values, 2, bitWidth) });
                    const result = tableFromIPC(tableToIPC(source, format));
                    const type = result.schema.fields[0].type as Decimal;
                    expect(type).toBeInstanceOf(Decimal);
                    expect(type.bitWidth).toBe(bitWidth);
                    expect(type.scale).toBe(2);
                    expect(type.precision).toBe(maxPrecision[bitWidth]);
                    expect([...result.getChild('d')!].map((x) => x!.unscaled)).toEqual(values);
                });
            }
        }
    });

    describe(`building from JS values`, () => {
        const strings = (values: any[], type: Decimal) => [...vectorFromArray(values, type)].map(String);

        test(`integer numbers mean the number (#77)`, () => {
            expect(strings([1, 12, 34], new Decimal(3, 18))).toEqual(['1.000', '12.000', '34.000']);
            expect(strings([-5, 0], new Decimal(2, 5))).toEqual(['-5.00', '0.00']);
        });

        test(`bigints mean the number`, () => {
            expect(strings([BigInt(1500), BigInt(-2)], new Decimal(3, 18))).toEqual(['1500.000', '-2.000']);
        });

        test(`decimal strings`, () => {
            expect(strings(['1.5', '-0.05', '+2', '.5', '7.', '1.5000', '-0'], new Decimal(3, 18)))
                .toEqual(['1.500', '-0.050', '2.000', '0.500', '7.000', '1.500', '0.000']);
        });

        test(`all bit widths`, () => {
            expect(strings(['-9999999.99'], new Decimal(2, 9, 32))).toEqual(['-9999999.99']);
            expect(strings(['9999999999999999.99'], new Decimal(2, 18, 64))).toEqual(['9999999999999999.99']);
            const max256 = `${'9'.repeat(70)}.${'9'.repeat(6)}`;
            expect(strings([`-${max256}`], new Decimal(6, 76, 256))).toEqual([`-${max256}`]);
        });

        test(`negative scales`, () => {
            expect(strings([12300, '-500'], new Decimal(-2, 5))).toEqual(['12300', '-500']);
            expect([...vectorFromArray([12300, '-500'], new Decimal(-2, 5))].map(Number)).toEqual([12300, -500]);
            expect(() => vectorFromArray([12345], new Decimal(-2, 5))).toThrow(RangeError);
        });

        test(`raw words, nulls, and Vector.set still work`, () => {
            const vector = vectorFromArray([toWords([BigInt(1999)], 128), null, '1'], new Decimal(2, 5));
            expect([...vector].map((x) => x === null ? x : String(x))).toEqual(['19.99', null, '1.00']);
            vector.set(2, '2.5');
            expect(`${vector.get(2)}`).toBe('2.50');
        });

        test(`non-integer numbers are rejected, like PyArrow floats`, () => {
            for (const value of [0.1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
                expect(() => vectorFromArray([value], new Decimal(3, 18))).toThrow(new TypeError(`Cannot convert ${value} to Decimal: expected an integer, bigint, or decimal string`));
            }
        });

        test(`strings that are not plain decimal numbers are rejected`, () => {
            for (const value of ['abc', '1e3', '', '.', '1.2.3', ' 1', '0x10', '1,5']) {
                expect(() => vectorFromArray([value], new Decimal(3, 18))).toThrow(new TypeError(`Cannot convert ${value} to Decimal: expected an integer, bigint, or decimal string`));
            }
        });

        test(`values that would lose digits are rejected`, () => {
            expect(() => vectorFromArray(['1.2345'], new Decimal(3, 18))).toThrow(RangeError);
            expect(strings(['1.2340'], new Decimal(3, 18))).toEqual(['1.234']);
        });

        test(`values that exceed the precision are rejected`, () => {
            expect(strings([999, '-999'], new Decimal(0, 3))).toEqual(['999', '-999']);
            expect(() => vectorFromArray([1000], new Decimal(0, 3))).toThrow(RangeError);
            expect(() => vectorFromArray(['10.00'], new Decimal(2, 3))).toThrow(RangeError);
        });
    });

    describe(`writes`, () => {
        test(`set() rejects negative indices`, () => {
            const vector = makeVector({ type: new Decimal(0, 9, 32), data: new Uint32Array([1, 2]) });
            expect(() => vector.set(-2, 3 as any)).toThrow(RangeError);
            expect([...vector].map(String)).toEqual(['1', '2']);
        });
    });

    test(`MapRow property lookup uses decimal keys`, () => {
        for (const bitWidth of [32, 128]) {
            const type = new Map_(new Field('entries', new Struct([
                new Field('key', new Decimal(2, 5, bitWidth), false),
                new Field('value', new Utf8()),
            ])));
            const builder = makeBuilder({ type });
            builder.append(new Map([['19.99', 'sale']]) as any);
            const row = builder.finish().toVector().get(0) as any;
            expect(Object.keys(row)).toEqual(['19.99']);
            expect(row['19.99']).toBe('sale');
        }
    });
});
