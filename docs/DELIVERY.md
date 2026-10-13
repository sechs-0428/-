# Windows用インストーラーの受け渡し

チャットに表示した `/workspace/...` のリンクは、開発環境内のファイルを示しています。Windows PCでダウンロードするURLとして使えることは確認できておらず、配布用リンクとして案内するのは適切ではありません。

現在の会話で利用できるツールには、作成済みの実行ファイルをユーザー向けダウンロードとして添付・公開する機能がありません。共有フォルダーへコピーするだけでも、ユーザー向けの添付にはなりません。

## 用意した配布物

`release/CareManager-Windows-0.1.0.zip` にインストーラー、手順、SHA-256をまとめました。ZIPの破損検査と、格納したインストーラーが検証済みファイルと同一であることを確認しています。

## GitHub経由で受け取る場合

既存の `sechs-0428/-` にアプリのソースと `.github/workflows/windows-installer.yml` を保存すると、Windows用のビルドをGitHub Actionsで実行できます。リポジトリの公開・非公開設定は変更しません。

ワークフローは依存パッケージの導入、テスト、Windowsインストーラー生成、Windows版ElectronのSQLite確認を行い、インストーラーと手順をZIPとして保存します。生成されたZIPは、GitHubにログインして対象リポジトリの「Actions」から完了した「Build Windows installer」を開き、「Artifacts」の `CareManager-Windows-0.1.0` を選ぶとダウンロードできます。有効期間は30日です。

ZIPをWindows PCで「すべて展開」し、その中の `CareManager-Setup-0.1.0.exe` を実行します。

この手順は、まだGitHubへ反映していません。チャット外のリポジトリへの書き込みについてユーザーの了承が必要です。GitHubへのGit読み取り接続は確認済みですが、この環境からのGitHub APIへの接続は拒否されました。Actionsがまだ実行されていないため、GitHub上のビルド成功やダウンロードリンクの利用可能性も未確認です。
