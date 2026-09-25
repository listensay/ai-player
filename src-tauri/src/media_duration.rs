//! Read container duration without creating a decoder or reading the media payload.
use std::{fs::File, io::{Read, Seek, SeekFrom}, path::Path};

const ASF_HEADER: [u8; 16] = [0x30,0x26,0xb2,0x75,0x8e,0x66,0xcf,0x11,0xa6,0xd9,0x00,0xaa,0x00,0x62,0xce,0x6c];
const ASF_FILE_PROPERTIES: [u8; 16] = [0xa1,0xdc,0xab,0x8c,0x47,0xa9,0xcf,0x11,0x8e,0xe4,0x00,0xc0,0x0c,0x20,0x53,0x65];

fn bytes<const N: usize>(reader: &mut (impl Read + Seek), offset: u64) -> Option<[u8; N]> {
    let mut result = [0; N];
    reader.seek(SeekFrom::Start(offset)).ok()?;
    reader.read_exact(&mut result).ok()?;
    Some(result)
}
fn positive(seconds: f64) -> Option<f64> {
    (seconds.is_finite() && seconds > 0.0).then_some(seconds)
}

fn mp4(reader: &mut (impl Read + Seek), start: u64, end: u64, inside_moov: bool) -> Option<f64> {
    let mut position = start;
    for _ in 0..4096 {
        if position.checked_add(8)? > end { return None; }
        let header = bytes::<8>(reader, position)?;
        let short_size = u32::from_be_bytes(header[..4].try_into().ok()?);
        let (size, header_size) = match short_size {
            0 => (end - position, 8),
            1 => (u64::from_be_bytes(bytes::<8>(reader, position + 8)?), 16),
            n => (u64::from(n), 8),
        };
        let next = position.checked_add(size)?;
        if size < header_size || next > end { return None; }
        let payload = position + header_size;
        match &header[4..8] {
            b"moov" if !inside_moov => {
                if let Some(duration) = mp4(reader, payload, next, true) { return Some(duration); }
            }
            b"mvhd" if inside_moov => {
                if payload.checked_add(4)? > next { return None; }
                let version = bytes::<4>(reader, payload)?[0];
                let (scale, duration) = match version {
                    0 if payload.checked_add(20)? <= next => {
                        let value = bytes::<8>(reader, payload + 12)?;
                        let duration = u32::from_be_bytes(value[4..].try_into().ok()?);
                        if duration == u32::MAX { return None; }
                        (u32::from_be_bytes(value[..4].try_into().ok()?), u64::from(duration))
                    }
                    1 if payload.checked_add(32)? <= next => {
                        let value = bytes::<12>(reader, payload + 20)?;
                        let duration = u64::from_be_bytes(value[4..].try_into().ok()?);
                        if duration == u64::MAX { return None; }
                        (u32::from_be_bytes(value[..4].try_into().ok()?), duration)
                    }
                    _ => return None,
                };
                if scale == 0 { return None; }
                return positive(duration as f64 / f64::from(scale));
            }
            _ => {}
        }
        position = next;
    }
    None
}

fn asf(reader: &mut (impl Read + Seek), length: u64) -> Option<f64> {
    let header = bytes::<30>(reader, 0)?;
    let end = u64::from_le_bytes(header[16..24].try_into().ok()?);
    let count = u32::from_le_bytes(header[24..28].try_into().ok()?);
    if end < 30 || end > length || count > 4096 { return None; }
    let mut position = 30u64;
    for _ in 0..count {
        if position.checked_add(24)? > end { return None; }
        let object = bytes::<24>(reader, position)?;
        let size = u64::from_le_bytes(object[16..].try_into().ok()?);
        let next = position.checked_add(size)?;
        if size < 24 || next > end { return None; }
        if object[..16] == ASF_FILE_PROPERTIES {
            if size < 104 { return None; }
            let properties = bytes::<80>(reader, position + 24)?;
            let play = u64::from_le_bytes(properties[40..48].try_into().ok()?);
            let preroll = u64::from_le_bytes(properties[56..64].try_into().ok()?);
            let flags = u32::from_le_bytes(properties[64..68].try_into().ok()?);
            if flags & 1 != 0 { return None; } // Broadcast streams have no fixed duration.
            return positive(play as f64 / 10_000_000.0 - preroll as f64 / 1000.0);
        }
        position = next;
    }
    None
}

fn duration(reader: &mut (impl Read + Seek), length: u64) -> Option<f64> {
    let header = bytes::<16>(reader, 0)?;
    if header == ASF_HEADER { return asf(reader, length); }
    match &header[4..8] {
        b"ftyp" | b"moov" | b"mdat" | b"free" | b"wide" | b"skip" => mp4(reader, 0, length, false),
        _ => None,
    }
}

pub fn read_duration(path: &Path) -> Option<f64> {
    let mut file = File::open(path).ok()?;
    let length = file.metadata().ok()?.len();
    duration(&mut file, length)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    fn atom(kind: &[u8; 4], payload: &[u8]) -> Vec<u8> {
        let mut value = ((payload.len() + 8) as u32).to_be_bytes().to_vec();
        value.extend(kind); value.extend(payload); value
    }
    fn movie(version: u8, scale: u32, ticks: u64) -> Vec<u8> {
        let mut payload = vec![0; if version == 0 { 20 } else { 32 }]; payload[0] = version;
        let offset = if version == 0 { 12 } else { 20 };
        payload[offset..offset+4].copy_from_slice(&scale.to_be_bytes());
        if version == 0 { payload[offset+4..].copy_from_slice(&(ticks as u32).to_be_bytes()); }
        else { payload[offset+4..].copy_from_slice(&ticks.to_be_bytes()); }
        atom(b"moov", &atom(b"mvhd", &payload))
    }
    fn parse(value: Vec<u8>) -> Option<f64> { let length = value.len() as u64; duration(&mut Cursor::new(value), length) }
    #[test]
    fn mp4_versions_and_movie_at_end() {
        for version in [0, 1] {
            let mut value = atom(b"ftyp", b"isom0000");
            value.extend(atom(b"mdat", &[0; 200])); value.extend(movie(version, 1000, 123456));
            assert_eq!(parse(value), Some(123.456));
        }
        assert_eq!(parse(movie(1, 1000, u64::from(u32::MAX)+1000)), Some((u64::from(u32::MAX)+1000) as f64/1000.0));
    }
    #[test]
    fn extended_and_zero_size_atoms() {
        let mut value = 1u32.to_be_bytes().to_vec(); value.extend(b"free"); value.extend(16u64.to_be_bytes());
        value.extend(movie(0, 25, 250)); assert_eq!(parse(value), Some(10.0));
        let mut value = movie(0, 25, 250); value[..4].copy_from_slice(&0u32.to_be_bytes());
        assert_eq!(parse(value), Some(10.0));
    }
    #[test]
    fn invalid_and_unknown_durations_do_not_become_estimates() {
        assert_eq!(parse(movie(0, 0, 100)), None);
        assert_eq!(parse(movie(0, 1000, u64::from(u32::MAX))), None);
        assert_eq!(parse(movie(1, 1000, u64::MAX)), None);
        let mut value = movie(0, 25, 250); value.truncate(value.len()-1); assert_eq!(parse(value), None);
        let mut value = movie(0, 25, 250); value[..4].copy_from_slice(&7u32.to_be_bytes()); assert_eq!(parse(value), None);
        assert_eq!(parse(vec![0; 32]), None);
    }
    #[test]
    fn wmv_subtracts_preroll_and_rejects_broadcast() {
        let mut value = ASF_HEADER.to_vec(); value.extend(134u64.to_le_bytes()); value.extend(1u32.to_le_bytes()); value.extend([1,2]);
        value.extend(ASF_FILE_PROPERTIES); value.extend(104u64.to_le_bytes()); value.extend([0;80]);
        value[94..102].copy_from_slice(&1_230_000_000u64.to_le_bytes());
        value[110..118].copy_from_slice(&3000u64.to_le_bytes());
        assert_eq!(parse(value.clone()), Some(120.0));
        value[118] = 1; assert_eq!(parse(value), None);
    }
    #[test]
    fn large_media_payload_is_skipped() {
        let mut file = tempfile::tempfile().unwrap();
        use std::io::Write;
        file.write_all(&1u32.to_be_bytes()).unwrap(); file.write_all(b"mdat").unwrap(); file.write_all(&(1u64<<32).to_be_bytes()).unwrap();
        file.seek(SeekFrom::Start(1u64<<32)).unwrap(); file.write_all(&movie(0,1000,5000)).unwrap();
        let length = file.metadata().unwrap().len();
        assert_eq!(duration(&mut file, length), Some(5.0));
    }
}
