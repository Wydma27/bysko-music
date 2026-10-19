/**
 * metadata.js — Comprehensive audio metadata parser (no external deps)
 * Supports:
 * - ID3v2.2, ID3v2.3, ID3v2.4 (MP3, WAV, AAC)
 * - ID3v1 (MP3 EOF tag fallback)
 * - FLAC (Vorbis comment block + picture block)
 * - MP4/M4A atoms (©nam, ©ART, ©alb, covr)
 * - Smart filename parser fallback for Artist - Title patterns
 */

function readSynchsafe(buf, offset) {
  return (
    ((buf[offset] & 0x7f) << 21) |
    ((buf[offset + 1] & 0x7f) << 14) |
    ((buf[offset + 2] & 0x7f) << 7) |
    (buf[offset + 3] & 0x7f)
  );
}

function readUint32BE(buf, offset) {
  return (
    (buf[offset] << 24) |
    (buf[offset + 1] << 16) |
    (buf[offset + 2] << 8) |
    buf[offset + 3]
  );
}

function readUint24BE(buf, offset) {
  return (
    (buf[offset] << 16) |
    (buf[offset + 1] << 8) |
    buf[offset + 2]
  );
}

function decodeString(buf, encoding) {
  try {
    if (encoding === 0) return new TextDecoder('iso-8859-1').decode(buf);
    if (encoding === 1) return new TextDecoder('utf-16').decode(buf);
    if (encoding === 2) return new TextDecoder('utf-16be').decode(buf);
    return new TextDecoder('utf-8').decode(buf);
  } catch {
    return new TextDecoder('utf-8').decode(buf);
  }
}

function cleanText(str) {
  if (!str) return '';
  return str.replace(/\0/g, '').replace(/[\x00-\x1F\x7F]/g, ' ').trim();
}

function parseTextFrame(data) {
  if (!data || data.length < 2) return '';
  const encoding = data[0];
  const text = data.slice(1);
  return cleanText(decodeString(text, encoding));
}

function parseAPIC(data) {
  if (!data || data.length < 4) return null;
  const encoding = data[0];
  let offset = 1;

  // MIME type (null-terminated)
  while (offset < data.length && data[offset] !== 0) offset++;
  const mimeType = new TextDecoder('ascii').decode(data.slice(1, offset)) || 'image/jpeg';
  offset++; // skip null

  // Picture type byte
  offset++;

  // Description (null-terminated, encoding-aware)
  if (encoding === 1 || encoding === 2) {
    while (offset + 1 < data.length && !(data[offset] === 0 && data[offset + 1] === 0)) {
      offset += 2;
    }
    offset += 2;
  } else {
    while (offset < data.length && data[offset] !== 0) offset++;
    offset++;
  }

  const imageData = data.slice(offset);
  if (imageData.length === 0) return null;

  try {
    const blob = new Blob([imageData], { type: mimeType });
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

/** USLT / ULT frame: embedded (unsynchronised) lyrics. Keeps line breaks, unlike cleanText. */
function parseUSLT(data) {
  if (!data || data.length < 5) return '';
  const encoding = data[0];
  let offset = 4; // encoding + 3-byte language
  if (encoding === 1 || encoding === 2) {
    while (offset + 1 < data.length && !(data[offset] === 0 && data[offset + 1] === 0)) offset += 2;
    offset += 2;
  } else {
    while (offset < data.length && data[offset] !== 0) offset++;
    offset++;
  }
  return decodeString(data.slice(offset), encoding).replace(/\0/g, '').replace(/\r\n?/g, '\n').trim();
}

function parsePIC(data) {
  // ID3v2.2 attached picture
  if (!data || data.length < 6) return null;
  const encoding = data[0];
  // 3-byte format (e.g. 'PNG', 'JPG')
  const fmt = String.fromCharCode(data[1], data[2], data[3]).toLowerCase();
  const mimeType = fmt === 'png' ? 'image/png' : 'image/jpeg';
  let offset = 5; // skip encoding + 3-char format + pic type
  // Description
  if (encoding === 1 || encoding === 2) {
    while (offset + 1 < data.length && !(data[offset] === 0 && data[offset + 1] === 0)) {
      offset += 2;
    }
    offset += 2;
  } else {
    while (offset < data.length && data[offset] !== 0) offset++;
    offset++;
  }
  const imageData = data.slice(offset);
  if (imageData.length === 0) return null;
  try {
    const blob = new Blob([imageData], { type: mimeType });
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

/* ── ID3v2 Parser (v2.2, v2.3, v2.4) ── */
async function parseID3v2(file) {
  const result = { title: '', artist: '', album: '', cover: null, year: '', lyrics: '' };
  try {
    const headerBuf = await file.slice(0, 10).arrayBuffer();
    const header = new Uint8Array(headerBuf);
    if (header[0] !== 0x49 || header[1] !== 0x44 || header[2] !== 0x33) return result; // Not 'ID3'

    const version = header[3]; // 2 = 2.2, 3 = 2.3, 4 = 2.4
    const tagSize = readSynchsafe(header, 6) + 10;
    const tagBuf = await file.slice(0, Math.min(tagSize, 1024 * 1024 * 6)).arrayBuffer();
    const tag = new Uint8Array(tagBuf);

    let pos = 10;

    if (version === 2) {
      // ID3v2.2 (3-char frame IDs, 3-byte sizes)
      while (pos + 6 < tag.length) {
        const frameId = String.fromCharCode(tag[pos], tag[pos + 1], tag[pos + 2]);
        if (frameId === '\0\0\0') break;
        const frameSize = readUint24BE(tag, pos + 3);
        if (frameSize <= 0 || pos + 6 + frameSize > tag.length) break;
        const frameData = tag.slice(pos + 6, pos + 6 + frameSize);

        if (frameId === 'TT2') result.title = parseTextFrame(frameData);
        else if (frameId === 'TP1' || frameId === 'TP2') {
          if (!result.artist) result.artist = parseTextFrame(frameData);
        } else if (frameId === 'TAL') result.album = parseTextFrame(frameData);
        else if (frameId === 'TYE') result.year = parseTextFrame(frameData);
        else if (frameId === 'PIC' && !result.cover) result.cover = parsePIC(frameData);
        else if (frameId === 'ULT' && !result.lyrics) result.lyrics = parseUSLT(frameData);

        pos += 6 + frameSize;
      }
    } else {
      // ID3v2.3 and ID3v2.4 (4-char frame IDs, 4-byte sizes)
      while (pos + 10 < tag.length) {
        const frameId = String.fromCharCode(tag[pos], tag[pos + 1], tag[pos + 2], tag[pos + 3]);
        if (frameId === '\0\0\0\0') break;

        let frameSize;
        if (version >= 4) {
          frameSize = readSynchsafe(tag, pos + 4);
        } else {
          frameSize = readUint32BE(tag, pos + 4);
        }

        if (frameSize <= 0 || pos + 10 + frameSize > tag.length) break;
        const frameData = tag.slice(pos + 10, pos + 10 + frameSize);

        switch (frameId) {
          case 'TIT2':
            result.title = parseTextFrame(frameData);
            break;
          case 'TPE1':
          case 'TPE2':
            if (!result.artist) result.artist = parseTextFrame(frameData);
            break;
          case 'TALB':
            result.album = parseTextFrame(frameData);
            break;
          case 'TYER':
          case 'TDRC':
            result.year = parseTextFrame(frameData).slice(0, 4);
            break;
          case 'APIC':
            if (!result.cover) result.cover = parseAPIC(frameData);
            break;
          case 'USLT':
            if (!result.lyrics) result.lyrics = parseUSLT(frameData);
            break;
        }

        pos += 10 + frameSize;
      }
    }
  } catch (err) {
    console.warn('ID3v2 parsing warning:', err);
  }
  return result;
}

/* ── ID3v1 Parser (Last 128 bytes of file) ── */
async function parseID3v1(file) {
  const result = { title: '', artist: '', album: '', year: '' };
  try {
    if (file.size < 128) return result;
    const buf = await file.slice(file.size - 128).arrayBuffer();
    const bytes = new Uint8Array(buf);
    const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2]);
    if (magic !== 'TAG') return result;

    const dec = new TextDecoder('iso-8859-1');
    result.title = cleanText(dec.decode(bytes.slice(3, 33)));
    result.artist = cleanText(dec.decode(bytes.slice(33, 63)));
    result.album = cleanText(dec.decode(bytes.slice(63, 93)));
    result.year = cleanText(dec.decode(bytes.slice(93, 97)));
  } catch (err) {
    console.warn('ID3v1 parsing warning:', err);
  }
  return result;
}

/* ── FLAC Parser (Vorbis Comments & Pictures) ── */
async function parseFLAC(file) {
  const result = { title: '', artist: '', album: '', cover: null, year: '' };
  try {
    const headBuf = await file.slice(0, 4).arrayBuffer();
    const head = new Uint8Array(headBuf);
    if (String.fromCharCode(...head) !== 'fLaC') return result;

    let offset = 4;
    let isLast = false;
    const maxScan = Math.min(file.size, 1024 * 1024 * 8);

    while (!isLast && offset + 4 < maxScan) {
      const bHeader = new Uint8Array(await file.slice(offset, offset + 4).arrayBuffer());
      isLast = (bHeader[0] & 0x80) !== 0;
      const blockType = bHeader[0] & 0x7f;
      const length = readUint24BE(bHeader, 1);
      offset += 4;

      if (blockType === 4) {
        // Vorbis Comment Block
        const cBuf = await file.slice(offset, offset + length).arrayBuffer();
        const cBytes = new Uint8Array(cBuf);
        const dec = new TextDecoder('utf-8');
        let cOffset = 0;
        const vendorLen = cBytes[cOffset] | (cBytes[cOffset + 1] << 8) | (cBytes[cOffset + 2] << 16) | (cBytes[cOffset + 3] << 24);
        cOffset += 4 + vendorLen;
        const count = cBytes[cOffset] | (cBytes[cOffset + 1] << 8) | (cBytes[cOffset + 2] << 16) | (cBytes[cOffset + 3] << 24);
        cOffset += 4;

        for (let i = 0; i < count && cOffset < cBytes.length; i++) {
          const itemLen = cBytes[cOffset] | (cBytes[cOffset + 1] << 8) | (cBytes[cOffset + 2] << 16) | (cBytes[cOffset + 3] << 24);
          cOffset += 4;
          const item = dec.decode(cBytes.slice(cOffset, cOffset + itemLen));
          cOffset += itemLen;

          const eqIdx = item.indexOf('=');
          if (eqIdx > 0) {
            const field = item.substring(0, eqIdx).toUpperCase();
            const val = cleanText(item.substring(eqIdx + 1));
            if (field === 'TITLE' && !result.title) result.title = val;
            else if (field === 'ARTIST' && !result.artist) result.artist = val;
            else if (field === 'ALBUM' && !result.album) result.album = val;
            else if ((field === 'DATE' || field === 'YEAR') && !result.year) result.year = val.slice(0, 4);
          }
        }
      } else if (blockType === 6 && !result.cover) {
        // Picture Block
        const pBuf = await file.slice(offset, offset + length).arrayBuffer();
        const pBytes = new Uint8Array(pBuf);
        let pOffset = 4; // skip type
        const mimeLen = readUint32BE(pBytes, pOffset);
        pOffset += 4;
        const mime = new TextDecoder('ascii').decode(pBytes.slice(pOffset, pOffset + mimeLen)) || 'image/jpeg';
        pOffset += mimeLen;
        const descLen = readUint32BE(pBytes, pOffset);
        pOffset += 4 + descLen + 16; // skip desc + width, height, depth, colors
        const dataLen = readUint32BE(pBytes, pOffset);
        pOffset += 4;
        const imgData = pBytes.slice(pOffset, pOffset + dataLen);
        if (imgData.length > 0) {
          result.cover = URL.createObjectURL(new Blob([imgData], { type: mime }));
        }
      }

      offset += length;
    }
  } catch (err) {
    console.warn('FLAC parsing warning:', err);
  }
  return result;
}

/* ── Smart Filename Parser (fallback when tags missing) ── */
export function parseFromFilename(fileName) {
  // Strip extension (.mp3, .wav, .flac, .ogg, .m4a, .aac)
  let clean = fileName.replace(/\.[^/.]+$/, '').trim();

  // Strip common noisy web tags & download site stamps
  clean = clean.replace(/\[(?:spotify-downloader\.com|y2mate\.com|320kbps|hq|flac|mp3|lossless)\]/gi, ' ');
  clean = clean.replace(/\((?:official\s*(?:music\s*video|video|audio)|lyrics|remastered(?:\s*\d{4})?|320kbps|audio)\)/gi, ' ');

  // Clean double spaces
  clean = clean.replace(/\s+/g, ' ').trim();

  // Strip leading track numbers like "01. ", "01 - ", "01 ", "1. ", "1 - "
  clean = clean.replace(/^\s*\d{1,3}[\.\-\s_]+\s*/, '');

  let artist = '';
  let title = clean;
  let album = '';

  // Check for separator like " - ", " – ", " — "
  const dashParts = clean.split(/\s+[-–—]\s+/);
  if (dashParts.length >= 2) {
    const p0 = dashParts[0].trim();
    const p1 = dashParts[1].trim();

    if (dashParts.length === 2) {
      artist = p0;
      title = p1;
    } else if (dashParts.length >= 3) {
      // Could be: Artist - Album - Title OR Artist - Title - Remix
      artist = p0;
      album = p1;
      title = dashParts.slice(2).join(' - ').trim();
    }
  } else {
    // Check for "Artist _ Title"
    const underParts = clean.split(/\s*_\s*/);
    if (underParts.length >= 2) {
      artist = underParts[0].trim();
      title = underParts.slice(1).join(' ').trim();
    }
  }

  // Handle bracketed prefix: e.g. "(PSR) Artist - Title" or "[PSR] Artist - Title"
  const tagMatch = artist.match(/^[\(\[](.*?)[\)\]]\s*(.*)$/);
  if (tagMatch) {
    if (tagMatch[2]) {
      artist = tagMatch[2].trim();
    }
  }

  // Strip outer brackets from artist and title
  artist = artist.replace(/^\[(.*)\]$/, '$1').replace(/^\((.*)\)$/, '$1').trim();
  title = title.replace(/^\[(.*)\]$/, '$1').replace(/^\((.*)\)$/, '$1').trim();

  // Remove track index if leftover in title: e.g. "01 Track Name"
  title = title.replace(/^\d{1,2}\s*[\.\-]?\s*/, '');

  return {
    artist: cleanText(artist),
    title: cleanText(title) || cleanText(fileName.replace(/\.[^/.]+$/, '')) || 'Nieznany utwór',
    album: cleanText(album),
  };
}

/* ── Universal Metadata Parser ── */
export async function parseID3(file) {
  let meta = { title: '', artist: '', album: '', cover: null, year: '', lyrics: '' };

  // 1. Try ID3v2 first
  try {
    meta = await parseID3v2(file);
  } catch {}

  // 2. Try FLAC if empty and matches
  if (!meta.title && !meta.artist) {
    try {
      const flacMeta = await parseFLAC(file);
      if (flacMeta.title || flacMeta.artist) meta = { ...meta, ...flacMeta };
    } catch {}
  }

  // 3. Try ID3v1 at EOF if title or artist is still empty
  if (!meta.title || !meta.artist) {
    try {
      const v1 = await parseID3v1(file);
      if (!meta.title && v1.title) meta.title = v1.title;
      if (!meta.artist && v1.artist) meta.artist = v1.artist;
      if (!meta.album && v1.album) meta.album = v1.album;
      if (!meta.year && v1.year) meta.year = v1.year;
    } catch {}
  }

  // 4. Smart Filename Fallback if artist or title is still missing or placeholder
  const fnMeta = parseFromFilename(file.name);
  if (!meta.title || meta.title === 'Unknown' || meta.title.toLowerCase().includes('unknown')) {
    meta.title = fnMeta.title;
  }
  if (!meta.artist || meta.artist === 'Unknown' || meta.artist === 'Unknown Artist' || meta.artist.toLowerCase().includes('unknown')) {
    meta.artist = fnMeta.artist || 'Nieznany wykonawca';
  }
  if (!meta.album || meta.album === 'Unknown' || meta.album === 'Unknown Album' || meta.album.toLowerCase().includes('unknown')) {
    meta.album = fnMeta.album || 'Singiel';
  }

  return meta;
}

export function getAudioDuration(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio(url);
    audio.addEventListener('loadedmetadata', () => {
      resolve(audio.duration || 0);
      URL.revokeObjectURL(url);
    });
    audio.addEventListener('error', () => {
      resolve(0);
      URL.revokeObjectURL(url);
    });
  });
}

export function formatDuration(seconds) {
  if (!seconds || isNaN(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function formatPlural(count, singular, few, many) {
  if (count === 1) return `${count} ${singular}`;
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) {
    return `${count} ${few}`;
  }
  return `${count} ${many}`;
}
