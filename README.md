# create-workspace

monorepoとworkspaceを作成するCLIです。Turborepoの標準テンプレート、またはCloudflare Workers向けテンプレートを選び、確認後に生成コマンドを実行します。

## 開発環境

- Node.js 24系（24.11.0以上）。`.node-version`に開発用のメジャーバージョンを指定しています。
- pnpm 12.15.0（`package.json`で固定）。

Node.jsの対応範囲は`^24.11.0`（24.11.0以上、25.0.0未満）です。開発環境はtsdownの[要件](https://tsdown.dev/guide/getting-started)を満たすNode.js 24系です。

```sh
pnpm install --frozen-lockfile
pnpm prepack
```

依存関係のインストール時にLefthookがGit hookを設定します。コミット前にはステージ済みのJavaScript／TypeScript、JSON、CSS、GraphQL、HTML、MarkdownファイルにBiomeのチェックと自動修正を実行し、修正内容もステージします。自動修正後に診断が残る場合、コミットは中止されます。

## CLIの使い方

```sh
node dist/cli.mjs
node dist/cli.mjs --help
node dist/cli.mjs --version
```

引数なし・`--help`・`-h`はヘルプを、`--version`・`-v`は`package.json`のバージョンを表示し、終了コード0を返します。ヘルプとバージョンを同時に指定した場合はヘルプを優先します。未対応のオプションや位置引数は標準エラー出力にエラーを表示し、終了コード1を返します。

テンプレートを選ぶと、CLIは実行する`pnpm dlx create-turbo`コマンドを表示し、確認を求めます。`y`または`yes`で実行し、それ以外の入力ではキャンセルします。Cloudflareテンプレートを選んだ場合はプロジェクト名を指定します。

## 開発コマンド

| コマンド         | 内容                                                                     |
| ---------------- | ------------------------------------------------------------------------ |
| `pnpm build`     | tsdownで`src/cli.ts`から`dist/cli.mjs`とソースマップを生成               |
| `pnpm dev`       | ファイルの変更を監視して再ビルド                                         |
| `pnpm typecheck` | CLIソースとビルド設定をstrictモードで型チェック（ファイル出力なし）      |
| `pnpm check`     | Biomeで整形・推奨lint・import順序を確認                                  |
| `pnpm fix`       | Biomeで整形・安全なlint修正・import整理を適用                            |
| `pnpm format`    | Biomeで整形を適用                                                        |
| `pnpm prepack`   | `fix`、`typecheck`、`build`を実行。`pnpm pack`や`pnpm publish`時にも実行 |
| `pnpm pack`      | `prepack`を実行してから配布用のtarballを作成                             |

ビルド形式はNode.js向けES Modulesで、型宣言は出力しません。Biomeは[公式推奨](https://biomejs.dev/installation/quick-start/)に従って完全固定バージョンで導入し、2スペース・ダブルクォート・セミコロンありで統一しています。`.gitignore`の除外対象はBiomeの検査からも除外されます。

## 配布形式の確認

配布対象は`dist`です。パッケージメタデータの`package.json`とREADMEも含まれます。tarballを一時ディレクトリへインストールして、`bin`に登録した実行名から起動できます。

```sh
package_dir="$(mktemp -d)"
pnpm pack --pack-destination "$package_dir"
mkdir "$package_dir/consumer"
printf '{"private":true}\n' > "$package_dir/consumer/package.json"
pnpm --dir "$package_dir/consumer" add "$package_dir/create-workspace-0.0.1.tgz"
pnpm --dir "$package_dir/consumer" exec create-workspace --help
pnpm --dir "$package_dir/consumer" exec create-workspace --version
```

tarballのファイル名は現在の`package.json`のバージョンに合わせて変更してください。この段階ではローカル開発と配布形式の確認までを扱います。

## GitHub Packagesからの利用

このパッケージはGitHub Packagesのnpmレジストリに非公開パッケージとして公開します。利用には、パッケージへの読み取り権限と`read:packages`権限を持つPersonal Access Token (classic)が必要です。トークンは利用者の端末でのみ設定し、リポジトリへコミットしないでください。

```sh
pnpm login --registry=https://npm.pkg.github.com --scope=@ogawanouen
```

ユーザー名とトークンを求められたら、GitHubユーザー名とPersonal Access Token (classic)を入力します。認証後、CLIを実行できます。

```sh
pnpm dlx @ogawanouen/create-workspace --help
```

## リリース

`package.json`の`version`を更新し、変更をmainブランチへマージします。次に、バージョンと同じ`v`タグを作成してpushします。たとえばバージョンが`0.0.2`なら:

```sh
git tag v0.0.2
git push origin v0.0.2
```

タグpushでGitHub Actionsが依存関係を導入し、Biomeチェック、型チェック、ビルドを実行します。すべて成功し、タグのバージョンが`package.json`と一致した場合に、`GITHUB_TOKEN`でGitHub Packagesへ公開します。

GitHub Actionsの「Test generated Cloudflare workspace」は手動実行できます。CLIからCloudflareテンプレートを生成し、生成物の依存関係、Biomeチェック、型チェック、ビルドを確認します。

初回公開の準備からPC上でのCLI実行までの詳しい手順は[リリース手順](docs/src/content/docs/release.mdx)を参照してください。
