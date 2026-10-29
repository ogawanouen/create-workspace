# create-workspace

monorepoを作成し、既存のpnpm／Turborepo workspaceへアプリ・パッケージを追加するCLIです。

## 開発環境

- Node.js 24.22.1。`.node-version`に開発用バージョンを指定しています。
- pnpm 12.16.1（`package.json`で固定）。

Node.jsの対応範囲は`^24.22.1`（24.22.1以上、25.0.0未満）です。開発環境はtsdownの[要件](https://tsdown.dev/guide/getting-started)を満たすNode.js 24.22.1です。

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

引数なしで対話フローを開始します。`--help`・`-h`はヘルプを、`--version`・`-v`は`package.json`のバージョンを表示し、終了コード0を返します。ヘルプとバージョンを同時に指定した場合はヘルプを優先します。未対応のオプションや位置引数は標準エラー出力にエラーを表示し、終了コード1を返します。

実行場所から親階層の`pnpm-workspace.yaml`を探し、見つからない場合は`turbo.json`のある階層をルートとして扱います。サブディレクトリーからも実行できます。

選択項目は矢印キーで移動し、Enterで決定します。EscまたはCtrl+Cでキャンセルできます。

workspace内では次の順で選択・入力します。

1. 追加先を選択：`apps`、`packages`。
2. appsでは`React Router`、`シンプルなWorkers`、`Hono`、`Void + fate + Astryx`を選択。
3. ディレクトリー名を入力（必須）。パスは指定できません。appsはC3の制約に合わせて58文字以内の小文字英数字とハイフンを使用し、先頭と末尾は英数字にします。
4. `package.json`のパッケージ名を入力（必須、`@scope/name`も対応）。ディレクトリー名とは別に指定できます。
5. 作成先・パッケージ名・生成コマンド・ルートでの自動インストールを確認し、左右キーで`実行する`を選んでEnter。初期選択は`キャンセル`です。

入力不備、既存の作成先、workspace内のパッケージ名重複は該当項目を再入力します。workspaceの除外設定に一致する作成先も使用できません。

packagesは[create-tsdown](https://github.com/rolldown/tsdown/tree/main/packages/create-tsdown)の`minimal`テンプレートで生成し、ビルド・watch・型宣言出力を備えます。他のappsは[C3](https://developers.cloudflare.com/pages/get-started/c3/)でWorkers向けのTypeScriptプロジェクトを生成します。React RouterとHonoは`--framework`、シンプルなWorkersは`--type hello-world`を使用し、デプロイとGit初期化を無効にします。

Void + fate + Astryxは[create-fate](https://developers.cloudflare.com/workers/framework-guides/web-apps/fate/)のReact Voidサンプルを生成します。D1、Drizzle、Better Auth、fateのライブ更新を含み、AstryxのコンポーネントとSSR対応のneutralテーマを追加します。生成時はCloudflareへのログインやデプロイを行いません。

初回はアプリのディレクトリーで `pnpm run dev:setup` を実行してローカルDBと生成コードを準備し、`pnpm run dev` で開発します。`pnpm run build` でビルドできます。Cloudflareへのデプロイは `pnpm exec void deploy --platform cloudflare` を実行し、生成されたREADMEの手順に従ってください。

生成後はパッケージ名を設定し、ジェネレーターが作成した子のworkspace設定・lockfile・`node_modules`を整理します。ルートのYAMLのコメントや既存設定を保持して`apps/*`・`packages/*`を補い、esbuild・workerd（Astryx選択時は`@astryxdesign/core`も）のビルド許可を既存ポリシーに従って統合した後、ルートで`pnpm install`を実行します。明示的なビルド拒否やバージョン指定は維持します。生成・統合・インストールが失敗した場合は終了コード1と失敗箇所・生成先を表示します。部分的に生成されたファイルは残るため、確認してから再実行してください。

workspace外では従来どおり、新しいmonorepoを作成します。`デフォルト`（初期選択）または`Cloudflare`を矢印キーで選び、`pnpm dlx create-turbo`の実行を確認します。Cloudflareの場合はプロジェクト名も入力します。

## 開発コマンド

| コマンド               | 内容                                                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| `pnpm build`           | tsdownで`src/cli.ts`から`dist/cli.mjs`とソースマップを生成                               |
| `pnpm dev`             | ファイルの変更を監視して再ビルド                                                         |
| `pnpm typecheck`       | CLIソースとビルド設定をstrictモードで型チェック（ファイル出力なし）                      |
| `pnpm check`           | Biomeで整形・推奨lint・import順序を確認                                                  |
| `pnpm test`            | CLIをビルドして、外部コマンドを置き換えた結合テストを実行                                |
| `pnpm test:generators` | 一時workspaceで実ジェネレーター5種類・自動インストール・ビルドを確認（ネット接続が必要） |
| `pnpm fix`             | Biomeで整形・安全なlint修正・import整理を適用                                            |
| `pnpm format`          | Biomeで整形を適用                                                                        |
| `pnpm prepack`         | `fix`、`typecheck`、`build`を実行。`pnpm pack`や`pnpm publish`時にも実行                 |
| `pnpm pack`            | `prepack`を実行してから配布用のtarballを作成                                             |

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
