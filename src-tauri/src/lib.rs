use base64::Engine;
use rayon::prelude::*;
use serde::Serialize;
use std::path::PathBuf;
use image::GenericImageView;

#[derive(Serialize, Clone)]
struct ImageInfo {
    width: u32,
    height: u32,
    thumb_b64: String,
    path: String,
}

fn process_image(path: &str, max_size: u32) -> Result<ImageInfo, String> {
    let img = image::open(path).map_err(|e| format!("Failed to open image: {}", e))?;
    let (w, h) = img.dimensions();
    let thumb = img.thumbnail(max_size, max_size);
    let mut buf = std::io::Cursor::new(Vec::new());
    thumb
        .write_to(&mut buf, image::ImageFormat::Jpeg)
        .map_err(|e| format!("Thumb encode failed: {}", e))?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(buf.into_inner());
    Ok(ImageInfo {
        width: w,
        height: h,
        thumb_b64: b64,
        path: path.to_string(),
    })
}

/// Load a single image thumbnail. Called per-image from the frontend for progressive loading.
#[tauri::command]
fn load_image_thumb(path: String, max_thumb_size: Option<u32>) -> Result<ImageInfo, String> {
    let max_size = max_thumb_size.unwrap_or(200);
    process_image(&path, max_size)
}

/// Load multiple images in parallel using rayon thread pool.
#[tauri::command]
fn load_images_batch(paths: Vec<String>, max_thumb_size: Option<u32>) -> Vec<Result<ImageInfo, String>> {
    let max_size = max_thumb_size.unwrap_or(200);
    paths
        .par_iter()
        .map(|path| process_image(path, max_size))
        .collect()
}

/// Read a full-resolution image as base64 data URL for canvas operations.
#[tauri::command]
fn read_image_full(path: String) -> Result<String, String> {
    let data = std::fs::read(&path).map_err(|e| format!("Failed to read: {}", e))?;
    let ext = PathBuf::from(&path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_lowercase();
    let mime = match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "gif" => "image/gif",
        _ => "image/png",
    };
    let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
    Ok(format!("data:{};base64,{}", mime, b64))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_image_thumb,
            load_images_batch,
            read_image_full,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
