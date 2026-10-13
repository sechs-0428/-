# Windows用インストーラーの受け渡し

チャットに表示した `/workspace/...` のリンクは、開発環境内のファイルを示しています。Windows PCでダウンロードするURLとして使えることは確認できておらず、配布用リンクとして案内するのは適切ではありません。

現在の会話で利用できるツールには、作成済みの実行ファイルをユーザー向けダウンロードとして添付・公開する機能がありません。共有フォルダーへコピーするだけでも、ユーザー向けの添付にはなりません。

## 用意した配布物

`release/CareManager-Windows-0.1.0.zip` にインストーラー、手順、SHA-256をまとめました。ZIPの破損検査と、格納したインストーラーが検証済みファイルと同一であることを確認しています。

## GitHub経由で受け取る場合

既存の `sechs-0428/-` にアプリのソースと `.github/workflows/windows-installer.yml` を保存すると、Windows用のビルドをGitHub Actionsで実行できます。リポジトリの公開・非公開設定は変更しません。

ワークフローは依存パッケージの導入、テスト、Windowsインストーラー生成、Windows版ElectronのSQLite確認を行い、インストーラーと手順をZIPとして保存します。生成されたZIPは、GitHubにログインして対象リポジトリの「Actions」から完了した「Build Windows installer」を開き、「Artifacts」の `CareManager-Windows-0.1.0` を選ぶとダウンロードできます。有効期間は30日です。

ZIPをWindows PCで「すべて展開」し、その中の `CareManager-Setup-0.1.0.exe` を実行します。

ユーザーの了承後に `main` へソースとワークフローを保存しました。WindowsでのASAR検査のパス区切りを修正し、[実行番号4](https://github.com/sechs-0428/-/actions/runs/38392573744)でビルド成功と成果物1件の生成を確認しました。

成果物は `CareManager-Windows-0.1.0`、約113MBです。GitHubが表示したZIPのSHA-256は `fbfe0a741e11b2ba21b46ab67cd78db608cc7e15ae056d470ebde7f988877a23` です。Windows版ElectronのSQLite確認もこの実行に含まれます。インストール・GUI・複数PCでの共有・紙印刷は実機での確認が必要です。

この環境からのGitHub API接続には制限があり、GitHubの公開実行画面で成功と成果物生成を確認しました。GitHub Actionsの成果物をダウンロードするには、ユーザーがGitHubにログインする必要があります。
