use std::path::Path;

#[test]
fn shipping_rust_files_stay_under_200_lines() {
    visit(Path::new("src"));
}

#[test]
fn tracked_text_avoids_em_dashes() {
    for path in ["src", "tests", "README.md", "project.example.json"] {
        reject_em_dashes(Path::new(path));
    }
}

fn visit(path: &Path) {
    for entry in std::fs::read_dir(path).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            visit(&path);
        } else if path.extension().is_some_and(|extension| extension == "rs") {
            let lines = std::fs::read_to_string(&path).unwrap().lines().count();
            assert!(lines < 200, "{} has {lines} lines", path.display());
        }
    }
}

fn reject_em_dashes(path: &Path) {
    if path.is_dir() {
        for entry in std::fs::read_dir(path).unwrap() {
            reject_em_dashes(&entry.unwrap().path());
        }
    } else if path.extension().is_none_or(|extension| {
        matches!(
            extension.to_str(),
            Some("rs" | "md" | "json" | "txt" | "todo")
        )
    }) {
        let text = std::fs::read_to_string(path).unwrap();
        assert!(
            !text.contains('\u{2014}'),
            "{} contains forbidden punctuation",
            path.display()
        );
    }
}
