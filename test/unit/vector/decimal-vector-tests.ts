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
    Decimal, Field, Map_, Struct, Utf8, makeBuilder, makeTable, makeVector, tableFromIPC, tableToIPC, vectorFromArray
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
    test(`values are unscaled`, () => {
        const vector = decimalVector([BigInt(1999)], 2);
        expect(`${vector.get(0)}`).toBe('1999');
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
                    expect([...result.getChild('d')!].map(String)).toEqual(values.map(String));
                });
            }
        }
    });
});
