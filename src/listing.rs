//! 左ペイン（オブジェクト一覧・リソース一覧）の一覧生成ロジック。
//!
//! DOM に依存しない純粋関数としてまとめ、`cargo test` で検証できるようにする。

/// ユーザーゲームコード（クラスファイル）を格納するディレクトリ
pub const CODE_DIR: &str = "code";
/// アセットを格納するディレクトリ
pub const ASSETS_DIR: &str = "assets";

/// 画像として扱う拡張子（小文字）
const IMAGE_EXTS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "bmp"];
/// サウンドとして扱う拡張子（小文字）
const SOUND_EXTS: &[&str] = &["ogg", "wav", "mp3", "m4a", "aac", "flac"];
/// 3Dモデルとして扱う拡張子（小文字）
const MODEL_EXTS: &[&str] = &["glb", "gltf"];

/// ゲームの起点となるオブジェクト名
///
/// プロジェクト作成時に `code/gameMain.coffee` として配置し、
/// ゲーム実行時に最初にインスタンス化してオブジェクトリストへ追加する。
/// 作業者はこのクラスの編集からゲーム作成を始める。
pub const ENTRY_OBJECT_NAME: &str = "gameMain";

/// 起点オブジェクトかどうか
///
/// ファイルシステムが大文字小文字を区別しない環境も考慮し、区別せずに判定する。
pub fn is_entry_object(object_name: &str) -> bool {
    object_name.to_lowercase() == ENTRY_OBJECT_NAME.to_lowercase()
}

/// クラスファイルの拡張子（先頭のドットを含む）
pub const CLASS_FILE_EXT: &str = ".coffee";

/// プロジェクトを作成したとき・開いたときに存在を保証するディレクトリ
///
/// 無ければ作成する。これにより作業者はディレクトリを手作業で用意する必要がない。
pub const PROJECT_DIRS: [&str; 2] = [CODE_DIR, ASSETS_DIR];

/// タブ見出しの翻訳キーからリソース種別を得る
///
/// オブジェクトタブなど、リソースでないタブは `None` を返す。
pub fn kind_from_tab_key(tab_key: &str) -> Option<ResourceKind> {
    RESOURCE_ORDER
        .into_iter()
        .find(|kind| kind.label_key() == tab_key)
}

/// リソース種別の表示順（タブ・グループの並び順に共通で使う）
pub const RESOURCE_ORDER: [ResourceKind; 3] = [
    ResourceKind::Image,
    ResourceKind::Sound,
    ResourceKind::Model,
];

/// リソース一覧の分類
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum ResourceKind {
    /// 画像
    Image,
    /// サウンド
    Sound,
    /// 3Dモデル
    Model,
}

impl ResourceKind {
    /// タブ見出しの翻訳キー（実際の文言は web/locales/*.json が持つ）
    pub fn label_key(self) -> &'static str {
        match self {
            ResourceKind::Image => "pane.tab.image",
            ResourceKind::Sound => "pane.tab.sound",
            ResourceKind::Model => "pane.tab.model",
        }
    }

    /// `assets/` 配下の格納先ディレクトリ名
    ///
    /// 5.7節のアセットパック定義（images / sounds / models）と対応させる。
    pub fn dir_name(self) -> &'static str {
        match self {
            ResourceKind::Image => "images",
            ResourceKind::Sound => "sounds",
            ResourceKind::Model => "models",
        }
    }
}

/// 一覧表示用の名前比較
///
/// 大文字・小文字を区別せずに並べる。綴りが同一（大小文字違いのみ）の場合は
/// 元の文字列で比較し、並び順を安定させる。
/// オブジェクト一覧・リソース一覧・プロジェクト一覧で共通に使用する。
pub fn compare_display_names(a: &str, b: &str) -> std::cmp::Ordering {
    a.to_lowercase().cmp(&b.to_lowercase()).then_with(|| a.cmp(b))
}

/// オブジェクト名から、`code/` 直下のクラスファイル名を組み立てる
///
/// [`object_name`] の逆変換にあたる。
pub fn class_file_name(object_name: &str) -> String {
    format!("{object_name}{CLASS_FILE_EXT}")
}

/// ファイル名がオブジェクト（クラスファイル）かどうかを判定する
///
/// `code/` 直下の `*.coffee` はすべて同一構成のクラスファイルであり、
/// 例外なくオブジェクトとして扱う（特別扱いするエントリポイントは存在しない）。
pub fn is_object_file(file_name: &str) -> bool {
    !is_hidden(file_name) && extension(file_name).as_deref() == Some("coffee")
}

/// クラスファイル名からオブジェクト名（拡張子を除いた部分）を得る
pub fn object_name(file_name: &str) -> Option<String> {
    if !is_object_file(file_name) {
        return None;
    }
    // 名前に含まれるドットは保持したいので、最後のドットのみで分割する
    file_name.rsplit_once('.').map(|(stem, _)| stem.to_string())
}

/// ファイル名からリソース種別を判定する
///
/// 画像・音声・3Dモデルのいずれにも当てはまらないファイルは `None`（一覧の対象外）
pub fn classify_resource(file_name: &str) -> Option<ResourceKind> {
    let ext = extension(file_name)?;
    let ext = ext.as_str();
    if IMAGE_EXTS.contains(&ext) {
        Some(ResourceKind::Image)
    } else if SOUND_EXTS.contains(&ext) {
        Some(ResourceKind::Sound)
    } else if MODEL_EXTS.contains(&ext) {
        Some(ResourceKind::Model)
    } else {
        None
    }
}

/// `code/` 直下のファイル名一覧を、オブジェクト名の一覧へ変換する
///
/// 並び順は [`compare_display_names`]（大文字・小文字を区別しない名前順）。
///
/// ここで得た全オブジェクトが実行時のオブジェクトリストに登録され、
/// 設定FPSの間隔で `behavior` が呼ばれる。
pub fn collect_objects(file_names: &[String]) -> Vec<String> {
    let mut objects: Vec<String> = file_names.iter().filter_map(|f| object_name(f)).collect();
    objects.sort_by(|a, b| {
        // ゲーム作成の出発点なので、起点オブジェクトだけは常に先頭に置く
        match (is_entry_object(a), is_entry_object(b)) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => compare_display_names(a, b),
        }
    });
    objects
}

/// 種別ディレクトリ内のファイル名一覧から、その種別として扱えるものだけを集める
///
/// 拡張子が種別と一致しないファイル（手作業で置かれたもの等）と隠しファイルは除外する。
/// 並び順は [`compare_display_names`]（大文字・小文字を区別しない名前順）。
pub fn collect_resources(file_names: &[String], kind: ResourceKind) -> Vec<String> {
    let mut files: Vec<String> = file_names
        .iter()
        .filter(|f| !is_hidden(f) && classify_resource(f) == Some(kind))
        .cloned()
        .collect();
    files.sort_by(|a, b| compare_display_names(a, b));
    files
}

/// ドットで始まる隠しファイル（`.DS_Store` 等）かどうか
fn is_hidden(file_name: &str) -> bool {
    file_name.starts_with('.')
}

/// 拡張子を小文字で返す。拡張子が無い場合は `None`
fn extension(file_name: &str) -> Option<String> {
    file_name
        .rsplit_once('.')
        .map(|(_, ext)| ext.to_lowercase())
}

/// 左ペインのタブ1枚分の内容
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PaneTab {
    /// タブ見出しの翻訳キー
    pub label_key: String,
    /// タブ内に表示する項目（名前順）
    pub items: Vec<String>,
    /// 対象ディレクトリを利用できるか
    ///
    /// 利用できない場合だけ案内文を出す。単に0件のときは何も表示しない。
    pub dir_available: bool,
    /// ディレクトリを利用できない場合に表示する案内文の翻訳キー
    pub unavailable_message_key: String,
}

/// 再描画後に選択状態へ戻すタブの位置を求める
///
/// 直前に選択していたタブが残っていればその位置、無ければ先頭（オブジェクトタブ）。
pub fn active_tab_index(tabs: &[PaneTab], previous_label_key: &str) -> usize {
    tabs.iter()
        .position(|tab| tab.label_key == previous_label_key)
        .unwrap_or(0)
}

/// 左ペインのタブ一式を組み立てる
///
/// タブは常に オブジェクト → 画像 → 音声 → 3Dモデル の4枚を返す。
/// 中身が空のタブも位置が変わらないよう残し、`empty_message_key` で状況を伝える。
///
/// 各引数が `None` の場合は、該当ディレクトリが存在しないことを表す。
pub fn build_pane_tabs(
    code_files: Option<&[String]>,
    image_files: Option<&[String]>,
    sound_files: Option<&[String]>,
    model_files: Option<&[String]>,
) -> Vec<PaneTab> {
    let mut tabs = Vec::with_capacity(1 + RESOURCE_ORDER.len());

    // オブジェクトタブ
    tabs.push(PaneTab {
        label_key: "pane.tab.object".to_string(),
        items: code_files.map(collect_objects).unwrap_or_default(),
        dir_available: code_files.is_some(),
        unavailable_message_key: "pane.empty.codeDirMissing".to_string(),
    });

    // アセットタブ（種別ごと）。中身が空でもタブ位置が動かないよう必ず全種別を返す
    let sources = [image_files, sound_files, model_files];
    for (kind, files) in RESOURCE_ORDER.into_iter().zip(sources) {
        tabs.push(PaneTab {
            label_key: kind.label_key().to_string(),
            items: files
                .map(|f| collect_resources(f, kind))
                .unwrap_or_default(),
            dir_available: files.is_some(),
            unavailable_message_key: "pane.empty.assetsDirMissing".to_string(),
        });
    }

    tabs
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    // --- ResourceKind::label ---

    #[test]
    fn 種別は翻訳キーを返す() {
        assert_eq!(ResourceKind::Image.label_key(), "pane.tab.image");
        assert_eq!(ResourceKind::Sound.label_key(), "pane.tab.sound");
        assert_eq!(ResourceKind::Model.label_key(), "pane.tab.model");
    }

    #[test]
    fn 存在を保証するディレクトリはcodeとassets() {
        assert_eq!(PROJECT_DIRS, ["code", "assets"]);
    }

    // --- compare_display_names ---

    #[test]
    fn 名前比較は大文字小文字を区別しない() {
        use std::cmp::Ordering;
        assert_eq!(compare_display_names("apple", "Banana"), Ordering::Less);
        assert_eq!(compare_display_names("Banana", "apple"), Ordering::Greater);
        assert_eq!(compare_display_names("main", "Player"), Ordering::Less);
        assert_eq!(compare_display_names("Zombie", "apple"), Ordering::Greater);
    }

    #[test]
    fn 綴りが同一なら元の文字列で安定させる() {
        use std::cmp::Ordering;
        assert_ne!(compare_display_names("Player", "player"), Ordering::Equal);
        assert_eq!(compare_display_names("Player", "Player"), Ordering::Equal);
    }

    #[test]
    fn 名前比較はマルチバイト文字も扱える() {
        use std::cmp::Ordering;
        assert_eq!(compare_display_names("あ", "い"), Ordering::Less);
    }

    // --- is_object_file ---

    #[test]
    fn coffeeファイルはオブジェクトとして扱う() {
        assert!(is_object_file("Player.coffee"));
        assert!(is_object_file("敵キャラ.coffee"));
    }

    #[test]
    fn 拡張子の大文字小文字は区別しない() {
        assert!(is_object_file("Player.COFFEE"));
        assert!(is_object_file("Player.Coffee"));
    }

    #[test]
    fn クラスファイルは特別扱いせずすべてオブジェクトとして扱う() {
        // code/ 直下の .coffee はすべて同一構成・同一スーパークラス継承のため
        // エントリポイントのような例外は設けない
        assert!(is_object_file("main.coffee"));
        assert!(is_object_file("MAIN.COFFEE"));
    }

    #[test]
    fn coffee以外の拡張子は除外する() {
        assert!(!is_object_file("Player.js"));
        assert!(!is_object_file("config.toml"));
        assert!(!is_object_file("README.md"));
        assert!(!is_object_file("Player"));
    }

    #[test]
    fn ドットで始まる隠しファイルは除外する() {
        assert!(!is_object_file(".DS_Store"));
        assert!(!is_object_file(".coffee"));
    }

    // --- object_name ---

    #[test]
    fn オブジェクト名は拡張子を除いた部分になる() {
        assert_eq!(object_name("Player.coffee"), Some("Player".to_string()));
        assert_eq!(object_name("敵キャラ.coffee"), Some("敵キャラ".to_string()));
    }

    #[test]
    fn 名前に含まれるドットは保持する() {
        assert_eq!(object_name("My.Player.coffee"), Some("My.Player".to_string()));
    }

    #[test]
    fn オブジェクトでないファイルは値を返さない() {
        assert_eq!(object_name("Player.js"), None);
        assert_eq!(object_name(".DS_Store"), None);
    }

    #[test]
    fn mainという名前も通常のオブジェクト名として扱う() {
        assert_eq!(object_name("main.coffee"), Some("main".to_string()));
    }

    // --- class_file_name ---

    #[test]
    fn オブジェクト名から拡張子付きのファイル名を作る() {
        assert_eq!(class_file_name("Player"), "Player.coffee");
        assert_eq!(class_file_name("敵キャラ"), "敵キャラ.coffee");
    }

    #[test]
    fn ファイル名とオブジェクト名は相互に変換できる() {
        for name in ["Player", "main", "My.Player", "敵キャラ"] {
            let file = class_file_name(name);
            assert_eq!(object_name(&file), Some(name.to_string()), "{name}");
        }
    }

    // --- classify_resource ---

    #[test]
    fn 画像の拡張子を判定する() {
        for f in ["a.png", "a.jpg", "a.jpeg", "a.gif", "a.webp", "a.bmp", "A.PNG"] {
            assert_eq!(classify_resource(f), Some(ResourceKind::Image), "{f}");
        }
    }

    #[test]
    fn 音声の拡張子を判定する() {
        for f in ["a.ogg", "a.wav", "a.mp3", "a.m4a", "a.aac", "a.flac", "A.WAV"] {
            assert_eq!(classify_resource(f), Some(ResourceKind::Sound), "{f}");
        }
    }

    #[test]
    fn モデルの拡張子を判定する() {
        for f in ["a.glb", "a.gltf", "A.GLB"] {
            assert_eq!(classify_resource(f), Some(ResourceKind::Model), "{f}");
        }
    }

    #[test]
    fn 対象外の拡張子は種別なしになる() {
        for f in ["a.txt", "a.toml", "noext"] {
            assert_eq!(classify_resource(f), None, "{f}");
        }
    }

    // --- is_entry_object ---

    #[test]
    fn 起点オブジェクトを判定できる() {
        assert!(is_entry_object("gameMain"));
        assert!(!is_entry_object("Player"));
        assert!(!is_entry_object("gameMainSub"));
    }

    #[test]
    fn 起点オブジェクトの判定は大文字小文字を区別しない() {
        // 大文字小文字を区別しないファイルシステムでは同じファイルを指すため
        assert!(is_entry_object("gamemain"));
        assert!(is_entry_object("GAMEMAIN"));
    }

    // --- collect_objects ---

    #[test]
    fn 起点オブジェクトは常に先頭に並ぶ() {
        // ゲーム作成の出発点なので、名前順に関わらず最初に見せる
        let files = names(&["Player.coffee", "gameMain.coffee", "Boss.coffee"]);
        assert_eq!(
            collect_objects(&files),
            names(&["gameMain", "Boss", "Player"])
        );
    }

    #[test]
    fn 起点オブジェクトが無ければ通常の名前順になる() {
        let files = names(&["Player.coffee", "Boss.coffee"]);
        assert_eq!(collect_objects(&files), names(&["Boss", "Player"]));
    }

    #[test]
    fn オブジェクト一覧は名前順に並ぶ() {
        let files = names(&["Zombie.coffee", "Player.coffee", "Enemy.coffee"]);
        assert_eq!(collect_objects(&files), names(&["Enemy", "Player", "Zombie"]));
    }

    #[test]
    fn オブジェクト一覧は非coffeeと隠しファイルを除外する() {
        let files = names(&["main.coffee", "Player.coffee", "config.toml", ".DS_Store"]);
        assert_eq!(collect_objects(&files), names(&["main", "Player"]));
    }

    #[test]
    fn オブジェクト一覧は大文字小文字を区別せず並ぶ() {
        let files = names(&["zombie.coffee", "Player.coffee", "enemy.coffee", "Boss.coffee"]);
        assert_eq!(
            collect_objects(&files),
            names(&["Boss", "enemy", "Player", "zombie"])
        );
    }

    #[test]
    fn オブジェクトが無ければ空の一覧を返す() {
        assert_eq!(collect_objects(&names(&["config.toml"])), Vec::<String>::new());
        assert_eq!(collect_objects(&[]), Vec::<String>::new());
    }

    // --- dir_name / kind_from_tab_key ---

    #[test]
    fn 種別ごとの格納先ディレクトリ名を返す() {
        assert_eq!(ResourceKind::Image.dir_name(), "images");
        assert_eq!(ResourceKind::Sound.dir_name(), "sounds");
        assert_eq!(ResourceKind::Model.dir_name(), "models");
    }

    #[test]
    fn タブキーから種別を引ける() {
        assert_eq!(kind_from_tab_key("pane.tab.image"), Some(ResourceKind::Image));
        assert_eq!(kind_from_tab_key("pane.tab.sound"), Some(ResourceKind::Sound));
        assert_eq!(kind_from_tab_key("pane.tab.model"), Some(ResourceKind::Model));
    }

    #[test]
    fn リソースでないタブキーは種別なし() {
        assert_eq!(kind_from_tab_key("pane.tab.object"), None);
        assert_eq!(kind_from_tab_key(""), None);
    }

    // --- collect_resources ---

    #[test]
    fn 種別に合うファイルだけを集める() {
        let files = names(&["player.png", "bgm.ogg", "cat.glb"]);
        assert_eq!(
            collect_resources(&files, ResourceKind::Image),
            names(&["player.png"])
        );
        assert_eq!(
            collect_resources(&files, ResourceKind::Sound),
            names(&["bgm.ogg"])
        );
        assert_eq!(
            collect_resources(&files, ResourceKind::Model),
            names(&["cat.glb"])
        );
    }

    #[test]
    fn 種別に合わないファイルは除外する() {
        // 音声ディレクトリに置かれた動画ファイルなどは表示しない
        let files = names(&["movie.mp4", "memo.txt", "bgm.ogg"]);
        assert_eq!(
            collect_resources(&files, ResourceKind::Sound),
            names(&["bgm.ogg"])
        );
    }

    #[test]
    fn 隠しファイルはリソースに含めない() {
        let files = names(&[".DS_Store", "player.png"]);
        assert_eq!(
            collect_resources(&files, ResourceKind::Image),
            names(&["player.png"])
        );
    }

    #[test]
    fn リソースは大文字小文字を区別せず並ぶ() {
        let files = names(&["Tiles.png", "player.png", "Bg.png"]);
        assert_eq!(
            collect_resources(&files, ResourceKind::Image),
            names(&["Bg.png", "player.png", "Tiles.png"])
        );
    }

    #[test]
    fn 該当が無ければ空になる() {
        assert_eq!(
            collect_resources(&names(&["bgm.ogg"]), ResourceKind::Image),
            Vec::<String>::new()
        );
        assert_eq!(collect_resources(&[], ResourceKind::Image), Vec::<String>::new());
    }

    // --- active_tab_index ---

    #[test]
    fn 直前に選択していたタブの位置を返す() {
        let tabs = build_pane_tabs(Some(&[]), Some(&[]), Some(&[]), Some(&[]));
        assert_eq!(active_tab_index(&tabs, "pane.tab.sound"), 2);
        assert_eq!(active_tab_index(&tabs, "pane.tab.model"), 3);
    }

    #[test]
    fn 選択情報が無ければ先頭に戻す() {
        let tabs = build_pane_tabs(Some(&[]), Some(&[]), Some(&[]), Some(&[]));
        assert_eq!(active_tab_index(&tabs, ""), 0);
        assert_eq!(active_tab_index(&tabs, "pane.tab.unknown"), 0);
    }

    #[test]
    fn タブが無ければ先頭扱いにする() {
        assert_eq!(active_tab_index(&[], "pane.tab.sound"), 0);
    }

    // --- build_pane_tabs ---

    #[test]
    fn タブは常に4枚を決まった順で返す() {
        let tabs = build_pane_tabs(Some(&[]), Some(&[]), Some(&[]), Some(&[]));
        let keys: Vec<&str> = tabs.iter().map(|t| t.label_key.as_str()).collect();
        assert_eq!(
            keys,
            vec![
                "pane.tab.object",
                "pane.tab.image",
                "pane.tab.sound",
                "pane.tab.model",
            ]
        );
    }

    #[test]
    fn オブジェクトタブにはクラス名が入る() {
        let code = names(&["Player.coffee", "main.coffee", "config.toml"]);
        let tabs = build_pane_tabs(Some(&code), Some(&[]), Some(&[]), Some(&[]));
        assert_eq!(tabs[0].items, names(&["main", "Player"]));
    }

    #[test]
    fn 種別ディレクトリの内容がそれぞれのタブへ入る() {
        let images = names(&["player.png"]);
        let sounds = names(&["bgm.ogg"]);
        let models = names(&["cat.glb"]);
        let tabs = build_pane_tabs(Some(&[]), Some(&images), Some(&sounds), Some(&models));
        assert_eq!(tabs[1].items, names(&["player.png"]));
        assert_eq!(tabs[2].items, names(&["bgm.ogg"]));
        assert_eq!(tabs[3].items, names(&["cat.glb"]));
    }

    #[test]
    fn 種別ディレクトリに紛れた対象外ファイルは表示しない() {
        let sounds = names(&["ganbaruzo.mp4", "bgm.ogg"]);
        let tabs = build_pane_tabs(Some(&[]), Some(&[]), Some(&sounds), Some(&[]));
        assert_eq!(tabs[2].items, names(&["bgm.ogg"]));
    }

    #[test]
    fn 中身が空でもタブは残る() {
        let tabs = build_pane_tabs(Some(&[]), Some(&[]), Some(&[]), Some(&[]));
        assert_eq!(tabs.len(), 4);
        assert!(tabs.iter().all(|t| t.items.is_empty()));
    }

    #[test]
    fn ディレクトリを使えない場合は案内文を用意する() {
        let tabs = build_pane_tabs(None, None, None, None);
        assert!(tabs.iter().all(|t| !t.dir_available));
        assert_eq!(tabs[0].unavailable_message_key, "pane.empty.codeDirMissing");
        assert_eq!(tabs[1].unavailable_message_key, "pane.empty.assetsDirMissing");
        assert_eq!(tabs[3].unavailable_message_key, "pane.empty.assetsDirMissing");
    }

    #[test]
    fn ディレクトリがあれば0件でも案内文は出さない() {
        // 「◯◯がありません」は表示しない。追加カードだけを見せる
        let tabs = build_pane_tabs(Some(&[]), Some(&[]), Some(&[]), Some(&[]));
        assert!(tabs.iter().all(|t| t.dir_available));
        assert!(tabs.iter().all(|t| t.items.is_empty()));
    }
}
