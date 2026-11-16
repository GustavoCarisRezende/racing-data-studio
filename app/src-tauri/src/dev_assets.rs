//! Read-only frontend snapshot used only by a development process relaunched
//! after a reset, when `tauri dev` has already stopped its Vite child.

use std::{
    borrow::Cow,
    collections::BTreeMap,
    fs,
    path::{Component, Path},
};

use tauri::{
    Assets,
    utils::assets::{AssetKey, AssetsIter, CspHash},
};

const MAX_ASSET_BYTES: u64 = 128 * 1024 * 1024;

pub struct DevelopmentAssets {
    files: BTreeMap<String, Vec<u8>>,
}

impl DevelopmentAssets {
    pub fn empty() -> Self {
        Self {
            files: BTreeMap::new(),
        }
    }

    pub fn from_dist(root: &Path) -> Result<Self, String> {
        let metadata = fs::symlink_metadata(root)
            .map_err(|error| format!("RESET_FAILED: frontend de recuperação indisponível: {error}"))?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err("RESET_FAILED: diretório do frontend de recuperação não é seguro".into());
        }
        let root = root
            .canonicalize()
            .map_err(|error| format!("RESET_FAILED: frontend de recuperação indisponível: {error}"))?;
        let mut files = BTreeMap::new();
        let mut total_bytes = 0;
        read_assets(&root, &root, &mut total_bytes, &mut files)?;
        if !files.contains_key("/index.html") {
            return Err("RESET_FAILED: frontend de recuperação não contém index.html".into());
        }
        Ok(Self { files })
    }

    fn resolve_key(&self, key: &AssetKey) -> Option<&[u8]> {
        let path = Path::new(key.as_ref());
        if path.components().any(|component| {
            !matches!(component, Component::RootDir | Component::Normal(_))
        }) {
            return None;
        }
        self.files.get(key.as_ref()).map(Vec::as_slice)
    }
}

fn read_assets(
    root: &Path,
    directory: &Path,
    total_bytes: &mut u64,
    files: &mut BTreeMap<String, Vec<u8>>,
) -> Result<(), String> {
    for entry in fs::read_dir(directory)
        .map_err(|error| format!("RESET_FAILED: não foi possível ler o frontend de recuperação: {error}"))?
    {
        let entry = entry
            .map_err(|error| format!("RESET_FAILED: não foi possível ler o frontend de recuperação: {error}"))?;
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| format!("RESET_FAILED: não foi possível validar o frontend de recuperação: {error}"))?;
        if metadata.file_type().is_symlink() {
            return Err("RESET_FAILED: frontend de recuperação contém link simbólico".into());
        }
        if metadata.is_dir() {
            read_assets(root, &path, total_bytes, files)?;
            continue;
        }
        if !metadata.is_file() {
            return Err("RESET_FAILED: frontend de recuperação contém arquivo inválido".into());
        }
        *total_bytes = total_bytes
            .checked_add(metadata.len())
            .filter(|size| *size <= MAX_ASSET_BYTES)
            .ok_or_else(|| "RESET_FAILED: frontend de recuperação excede o limite permitido".to_string())?;

        let relative = path
            .strip_prefix(root)
            .map_err(|_| "RESET_FAILED: caminho inválido no frontend de recuperação".to_string())?;
        let key = AssetKey::from(relative);
        let bytes = fs::read(&path)
            .map_err(|error| format!("RESET_FAILED: não foi possível ler o frontend de recuperação: {error}"))?;
        files.insert(key.as_ref().to_string(), bytes);
    }
    Ok(())
}

impl<R: tauri::Runtime> Assets<R> for DevelopmentAssets {
    fn get(&self, key: &AssetKey) -> Option<Cow<'_, [u8]>> {
        self.resolve_key(key).map(Cow::Borrowed)
    }

    fn iter(&self) -> Box<AssetsIter<'_>> {
        Box::new(
            self.files
                .iter()
                .map(|(key, bytes)| (Cow::Borrowed(key.as_str()), Cow::Borrowed(bytes.as_slice()))),
        )
    }

    fn csp_hashes(&self, _html_path: &AssetKey) -> Box<dyn Iterator<Item = CspHash<'_>> + '_> {
        Box::new(std::iter::empty())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn fixture() -> PathBuf {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "rds-dev-assets-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir(&path).unwrap();
        path
    }

    #[test]
    fn loads_snapshot_and_rejects_parent_paths() {
        let root = fixture();
        fs::write(root.join("index.html"), b"<html></html>").unwrap();
        fs::create_dir(root.join("assets")).unwrap();
        fs::write(root.join("assets/app.js"), b"bundle").unwrap();

        let assets = DevelopmentAssets::from_dist(&root).unwrap();
        assert_eq!(
            assets.resolve_key(&AssetKey::from("assets/app.js")).unwrap(),
            b"bundle"
        );
        assert!(assets.resolve_key(&AssetKey::from("../outside")).is_none());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_missing_index_and_symlinks() {
        let root = fixture();
        fs::write(root.join("app.js"), b"bundle").unwrap();
        assert!(DevelopmentAssets::from_dist(&root).is_err());
        fs::write(root.join("index.html"), b"<html></html>").unwrap();

        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(root.join("index.html"), root.join("linked.html")).unwrap();
            assert!(DevelopmentAssets::from_dist(&root).is_err());
        }

        fs::remove_dir_all(root).unwrap();
    }
}
