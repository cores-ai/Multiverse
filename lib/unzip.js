import zlib from 'node:zlib';

/**
 * Robust Zero-Dependency Zip Unpacker using Node.js built-in zlib
 * Decodes ZIP headers, handles STORE and DEFLATE compression, and flattens wrapper folders.
 */
export function unpackZipBuffer(buffer) {
    const files = {};
    let offset = 0;

    // Scan Local File Headers (0x04034b50)
    while (offset < buffer.length - 30) {
        const sig = buffer.readUInt32LE(offset);
        if (sig !== 0x04034b50) {
            // Find next header or central directory
            const nextIdx = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]), offset + 1);
            if (nextIdx === -1) break;
            offset = nextIdx;
            continue;
        }

        const flags = buffer.readUInt16LE(offset + 6);
        const compMethod = buffer.readUInt16LE(offset + 8);
        let compSize = buffer.readUInt32LE(offset + 18);
        let uncompSize = buffer.readUInt32LE(offset + 22);
        const fnLen = buffer.readUInt16LE(offset + 26);
        const extraLen = buffer.readUInt16LE(offset + 28);

        const filename = buffer.toString('utf8', offset + 30, offset + 30 + fnLen);
        const dataOffset = offset + 30 + fnLen + extraLen;

        // Skip directories and Mac metadata
        if (filename.endsWith('/') || filename.includes('__MACOSX') || filename.includes('.DS_Store')) {
            offset = dataOffset + compSize;
            continue;
        }

        // Handle streaming data descriptor if compSize is 0
        if (compSize === 0 && (flags & 0x08)) {
            const nextSig = buffer.indexOf(Buffer.from([0x50, 0x4b]), dataOffset);
            if (nextSig !== -1) {
                compSize = nextSig - dataOffset;
            }
        }

        const compressedData = buffer.subarray(dataOffset, dataOffset + compSize);

        try {
            let decompressed;
            if (compMethod === 0) {
                // STORED
                decompressed = compressedData;
            } else if (compMethod === 8) {
                // DEFLATED
                decompressed = zlib.inflateRawSync(compressedData);
            } else {
                console.warn(`[Unzip] Unsupported compression method ${compMethod} for ${filename}`);
                offset = dataOffset + compSize;
                continue;
            }

            const isBinary = /\.(png|jpe?g|gif|ico|webp|svg|woff2?|eot|ttf|otf|pdf|zip|tar|gz|exe|bin|node|pyc)$/i.test(filename);
            if (isBinary) {
                files[filename] = {
                    content: decompressed.toString('base64'),
                    encoding: 'base64'
                };
            } else {
                files[filename] = {
                    content: decompressed.toString('utf8'),
                    encoding: 'utf-8'
                };
            }
        } catch (decompErr) {
            console.warn(`[Unzip Error] Could not decompress ${filename}:`, decompErr.message);
        }

        offset = dataOffset + compSize;
    }

    // Strip common wrapper directory prefix (e.g. "giveaway-main/")
    const entries = Object.keys(files);
    if (entries.length > 0) {
        const firstSlash = entries[0].indexOf('/');
        if (firstSlash !== -1) {
            const prefixCandidate = entries[0].substring(0, firstSlash + 1);
            if (entries.every(e => e.startsWith(prefixCandidate))) {
                const cleanedFiles = {};
                for (const [k, v] of Object.entries(files)) {
                    cleanedFiles[k.substring(prefixCandidate.length)] = v;
                }
                return cleanedFiles;
            }
        }
    }

    return files;
}
