import React, { useState } from 'react';

interface HelpSection {
  id: string;
  title: string;
  icon: React.ReactNode;
  content: React.ReactNode;
}

const HelpPage: React.FC = () => {
  const [activeSection, setActiveSection] = useState('overview');

  const sections: HelpSection[] = [
    {
      id: 'overview',
      title: 'アプリ概要',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
          <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
        </svg>
      ),
      content: (
        <div className="space-y-6">
          <h2 className="text-2xl font-bold text-gray-800">WelfareAssist Pro とは</h2>
          <p className="text-gray-600">福祉用具専門相談員向けの業務管理アプリです。利用者管理・月次売上処理・請求書突合・AI議事録生成など、日常業務をまとめて管理できます。</p>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h3 className="font-semibold text-blue-800 mb-2">ログイン</h3>
            <p className="text-blue-700 text-sm">会社のGoogleアカウント（@ドメイン）でログインしてください。</p>
          </div>

          <h3 className="text-lg font-semibold text-gray-700">画面構成</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-100">
                  <th className="border border-gray-300 px-3 py-2 text-left">エリア</th>
                  <th className="border border-gray-300 px-3 py-2 text-left">内容</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['左サイドバー', '利用者検索・フィルター・各種ページへのボタン'],
                  ['メインコンテンツ', '選択中の利用者詳細または各種ページ'],
                ].map(([area, desc]) => (
                  <tr key={area} className="hover:bg-gray-50">
                    <td className="border border-gray-300 px-3 py-2 font-medium">{area}</td>
                    <td className="border border-gray-300 px-3 py-2 text-gray-600">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className="text-lg font-semibold text-gray-700">サイドバーボタン一覧</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              { color: 'bg-sky-100 text-sky-800 border-sky-300', name: '福祉用具集計', desc: '福祉用具利用者の集計' },
              { color: 'bg-teal-100 text-teal-800 border-teal-300', name: '売上・仕入突合', desc: '卸会社請求書との突合' },
              { color: 'bg-violet-100 text-violet-800 border-violet-300', name: '月次売上処理', desc: '月次売上確認・CSV出力' },
              { color: 'bg-blue-100 text-blue-800 border-blue-300', name: '変更情報一覧', desc: '変更情報のCSV出力' },
              { color: 'bg-indigo-100 text-indigo-800 border-indigo-300', name: 'ベッド管理', desc: '自社ベッドの在庫管理' },
              { color: 'bg-rose-100 text-rose-800 border-rose-300', name: 'レセプトチェック', desc: '請求前チェックリスト' },
            ].map(({ color, name, desc }) => (
              <div key={name} className={`border rounded-lg p-3 ${color}`}>
                <div className="font-semibold">{name}</div>
                <div className="text-sm opacity-80">{desc}</div>
              </div>
            ))}
          </div>

          <h3 className="text-lg font-semibold text-gray-700">データの更新タイミング</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-100">
                  <th className="border border-gray-300 px-3 py-2 text-left">データ種別</th>
                  <th className="border border-gray-300 px-3 py-2 text-left">更新タイミング</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['利用者基本情報', '毎日 00:00 JST 自動更新（スプレッドシート連携）'],
                  ['変更レコード', '毎日 00:00 JST 自動更新（Kintone連携）'],
                  ['介護保険レンタル', '月次手動インポート（カイポケCSV）'],
                  ['手動編集内容', 'リアルタイム保存（自動更新の影響なし）'],
                ].map(([type, timing]) => (
                  <tr key={type} className="hover:bg-gray-50">
                    <td className="border border-gray-300 px-3 py-2 font-medium">{type}</td>
                    <td className="border border-gray-300 px-3 py-2 text-gray-600">{timing}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ),
    },
    {
      id: 'welfare-summary',
      title: '福祉用具集計',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
        </svg>
      ),
      content: (
        <div className="space-y-6">
          <h2 className="text-2xl font-bold text-gray-800">福祉用具集計</h2>
          <p className="text-gray-600">福祉用具を利用中の利用者を一覧・集計します。左サイドバー「福祉用具集計」ボタン（空色）からアクセスします。</p>

          <h3 className="text-lg font-semibold text-gray-700">3つの表示タブ</h3>
          <div className="space-y-3">
            {[
              { name: '施設別', color: 'bg-gray-50 border-gray-200 text-gray-800', desc: '在宅・各施設名でグループ化。施設内の居室番号も表示。' },
              { name: 'Status別', color: 'bg-gray-50 border-gray-200 text-gray-800', desc: '介護保険レンタル・自費利用・併用・未設定でグループ化。' },
              { name: '事業所別', color: 'bg-gray-50 border-gray-200 text-gray-800', desc: '鹿児島（ACG）・福岡（Lichi）ごとにフラット一覧で表示。施設や Status による絞り込みなし。' },
            ].map(({ name, color, desc }) => (
              <div key={name} className={`border rounded-lg p-3 ${color}`}>
                <div className="font-semibold mb-1">{name}</div>
                <div className="text-sm text-gray-600">{desc}</div>
              </div>
            ))}
          </div>

          <h3 className="text-lg font-semibold text-gray-700">事業所フィルター（施設別・Status別）</h3>
          <p className="text-gray-600 text-sm">施設別・Status別タブでは、上部に事業所フィルターボタンが表示されます。</p>
          <div className="flex gap-2 flex-wrap">
            <span className="px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-700 text-white">全事業所（n件）</span>
            <span className="px-3 py-1.5 rounded-lg text-sm font-medium bg-sky-600 text-white">鹿児島（ACG）（n件）</span>
            <span className="px-3 py-1.5 rounded-lg text-sm font-medium bg-violet-600 text-white">福岡（Lichi）（n件）</span>
          </div>
          <p className="text-gray-500 text-xs">事業所別タブではフィルターは表示されません（サブタブ自体が事業所を選択します）。</p>

          <h3 className="text-lg font-semibold text-gray-700">各利用者に表示される情報</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-100">
                  <th className="border border-gray-300 px-3 py-2 text-left">項目</th>
                  <th className="border border-gray-300 px-3 py-2 text-left">備考</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['氏名・カナ', ''],
                  ['生活保護バッジ', '生活保護受給者にオレンジバッジを表示'],
                  ['あおぞらID', ''],
                  ['要介護度', ''],
                  ['施設名（在宅/施設）', 'Status別・事業所別タブで表示'],
                  ['居室番号', '施設別タブ・施設入居中の場合のみ'],
                  ['福祉用具件数', '選定中の用具の件数'],
                  ['居宅介護支援事業所', '未設定時は非表示'],
                  ['担当CM', '未設定時は非表示'],
                ].map(([item, note]) => (
                  <tr key={item} className="hover:bg-gray-50">
                    <td className="border border-gray-300 px-3 py-2 font-medium">{item}</td>
                    <td className="border border-gray-300 px-3 py-2 text-gray-500 text-xs">{note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm text-green-800">
            <strong>定時更新後も影響なし</strong>：表示されるすべての情報（事業所・担当CM・居宅介護支援事業所・生保区分など）は毎日の自動更新後も保持されます。このページでのデータ書き込みは行いません。
          </div>
        </div>
      ),
    },
    {
      id: 'client',
      title: '利用者管理',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
        </svg>
      ),
      content: (
        <div className="space-y-6">
          <h2 className="text-2xl font-bold text-gray-800">利用者管理</h2>

          <h3 className="text-lg font-semibold text-gray-700">利用者を探す</h3>
          <p className="text-gray-600">左サイドバーの検索ボックスに<strong>氏名・カナ・あおぞらID</strong>を入力して絞り込めます。</p>
          <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-600">例：田中、タナカ、AZ-0001</div>

          <h3 className="text-lg font-semibold text-gray-700">利用者詳細（6タブ）</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-100">
                  <th className="border border-gray-300 px-3 py-2 text-left">タブ</th>
                  <th className="border border-gray-300 px-3 py-2 text-left">内容</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['Tab1: 基本情報', '事業所・施設名・ケアマネ・要介護度など基本属性'],
                  ['Tab2: 病歴・医療情報', '病歴・服薬情報・医療文書OCR'],
                  ['Tab3: 議事録', '担当者会議・訪問記録・AI議事録生成'],
                  ['Tab4: 変更情報', '新規・入院・退院・解約などの変更記録'],
                  ['Tab5: 福祉用具選定', 'レンタル・販売品目の一覧・追加'],
                  ['Tab6: 売上管理', '月別売上・仕入・粗利の確認'],
                ].map(([tab, desc]) => (
                  <tr key={tab} className="hover:bg-gray-50">
                    <td className="border border-gray-300 px-3 py-2 font-medium whitespace-nowrap">{tab}</td>
                    <td className="border border-gray-300 px-3 py-2 text-gray-600">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <h4 className="font-semibold text-yellow-800 mb-1">Tab1 編集の保存について</h4>
            <p className="text-yellow-700 text-sm">Tab1で編集した内容は毎日の自動更新後も保持されます。「保存」ボタンを押すとFirestoreに即時保存されます。</p>
          </div>

          <h3 className="text-lg font-semibold text-gray-700">AI議事録生成（Tab3）</h3>
          <p className="text-gray-600">「Meetメモから作成」ボタンから以下の3つの方法でメモを取込できます：</p>
          <div className="space-y-2">
            {[
              ['Google Docs URL', 'URLを貼り付けて「取得」ボタンをクリック。ドキュメントは「リンクを知っている全員が閲覧可」に設定が必要。'],
              ['テキスト貼り付け', 'Google Docsからコピーしたテキストをそのまま貼り付け。'],
              ['ファイルアップロード', '.txt または .pdf ファイルをアップロード。'],
            ].map(([method, desc]) => (
              <div key={method} className="flex gap-3 p-3 bg-gray-50 rounded-lg">
                <span className="font-semibold text-gray-700 whitespace-nowrap">{method}</span>
                <span className="text-gray-600 text-sm">{desc}</span>
              </div>
            ))}
          </div>
        </div>
      ),
    },
    {
      id: 'kaipoke',
      title: 'カイポケCSVインポート',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
        </svg>
      ),
      content: (
        <div className="space-y-6">
          <h2 className="text-2xl font-bold text-gray-800">カイポケCSVインポート</h2>
          <p className="text-gray-600">毎月の介護保険レンタルデータをカイポケからエクスポートし、アプリに取り込む手順です。</p>

          <h3 className="text-lg font-semibold text-gray-700">必要なファイル（2種類）</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-100">
                  <th className="border border-gray-300 px-3 py-2 text-left">ファイル名</th>
                  <th className="border border-gray-300 px-3 py-2 text-left">カイポケでの出力場所</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['サービスチェックシート.csv', 'カイポケ → 帳票出力 → サービスチェックシート'],
                  ['利用者請求.csv', 'カイポケ → 請求管理 → 利用者請求一覧'],
                ].map(([file, path]) => (
                  <tr key={file} className="hover:bg-gray-50">
                    <td className="border border-gray-300 px-3 py-2 font-medium">{file}</td>
                    <td className="border border-gray-300 px-3 py-2 text-gray-600">{path}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800">2ファイルとも同じ対象月で出力してください。</div>

          <h3 className="text-lg font-semibold text-gray-700">インポート手順</h3>
          <ol className="space-y-2 text-gray-600">
            {[
              '左サイドバー「月次売上処理」ボタンをクリック',
              '「介護保険レンタル」タブを選択',
              '右上「カイポケCSVインポート」ボタンをクリック',
              '対象月を選択（例：2026年1月）',
              '「サービスチェックシート.csv」をアップロード',
              '「利用者請求.csv」をアップロード',
              'プレビュー画面で取込内容を確認',
              'マッチングを確認（自動でできない場合は手動で紐づけ）',
              '「インポート実行」ボタンをクリック',
            ].map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 bg-violet-500 text-white rounded-full flex items-center justify-center text-xs font-bold">{i + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>

          <h3 className="text-lg font-semibold text-gray-700">よくあるエラー</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-100">
                  <th className="border border-gray-300 px-3 py-2 text-left">エラー</th>
                  <th className="border border-gray-300 px-3 py-2 text-left">原因・対処</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['「必要な列が見つかりません」', '別のCSVファイルを選択している → 正しいファイルか確認'],
                  ['利用者が大量に未マッチ', '2ファイルの対象月がずれている → 同じ月で再出力'],
                  ['インポート後にデータが表示されない', '対象月の選択が違う → 月次売上処理で正しい月を選択'],
                ].map(([error, cause]) => (
                  <tr key={error} className="hover:bg-gray-50">
                    <td className="border border-gray-300 px-3 py-2 font-medium text-red-700">{error}</td>
                    <td className="border border-gray-300 px-3 py-2 text-gray-600">{cause}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ),
    },
    {
      id: 'monthly-sales',
      title: '月次売上処理',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
        </svg>
      ),
      content: (
        <div className="space-y-6">
          <h2 className="text-2xl font-bold text-gray-800">月次売上処理</h2>
          <p className="text-gray-600">毎月の売上データを確認・確定し、CSVを出力する機能です。</p>

          <h3 className="text-lg font-semibold text-gray-700">3つのタブ</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-100">
                  <th className="border border-gray-300 px-3 py-2 text-left">タブ</th>
                  <th className="border border-gray-300 px-3 py-2 text-left">データソース</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['介護保険レンタル', 'カイポケCSVインポートで取込んだデータ'],
                  ['自費レンタル', 'スプレッドシート連携または手動入力データ'],
                  ['販売', 'スプレッドシート連携または手動入力データ'],
                ].map(([tab, source]) => (
                  <tr key={tab} className="hover:bg-gray-50">
                    <td className="border border-gray-300 px-3 py-2 font-medium">{tab}</td>
                    <td className="border border-gray-300 px-3 py-2 text-gray-600">{source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className="text-lg font-semibold text-gray-700">基本操作フロー</h3>
          <div className="flex items-center gap-2 flex-wrap text-sm">
            {['月度選択', '事業所フィルター', 'データ確認', 'CSV出力', '確定'].map((step, i, arr) => (
              <React.Fragment key={step}>
                <span className="bg-violet-100 text-violet-800 px-3 py-1 rounded-full font-medium">{step}</span>
                {i < arr.length - 1 && <span className="text-gray-400">→</span>}
              </React.Fragment>
            ))}
          </div>

          <h3 className="text-lg font-semibold text-gray-700">毎月の作業チェックリスト</h3>
          <ul className="space-y-2 text-gray-600">
            {[
              'カイポケCSVインポート済み（介護保険レンタルタブ）',
              '自費レンタル・販売データが最新か確認（前日 00:00 自動更新）',
              '事業所フィルターを正しく設定してCSV出力',
              '3タブすべて確定',
            ].map((item) => (
              <li key={item} className="flex gap-2 items-start">
                <span className="text-violet-500 mt-0.5">☐</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      ),
    },
    {
      id: 'reconciliation',
      title: '売上・仕入突合',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
        </svg>
      ),
      content: (
        <div className="space-y-6">
          <h2 className="text-2xl font-bold text-gray-800">売上・仕入突合</h2>
          <p className="text-gray-600">卸会社からの請求書と社内売上データを突合し、粗利を算出する機能です。</p>

          <h3 className="text-lg font-semibold text-gray-700">対応している卸会社</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-100">
                  <th className="border border-gray-300 px-3 py-2 text-left">卸会社</th>
                  <th className="border border-gray-300 px-3 py-2 text-center">PDF取込</th>
                  <th className="border border-gray-300 px-3 py-2 text-center">CSV取込</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['日建リース工業', true, false],
                  ['野口株式会社', true, false],
                  ['株式会社ニシケン', true, true],
                  ['パラマウントケアサービス', true, true],
                  ['日本ケアサプライ', true, true],
                  ['株式会社キシヤ', true, false],
                ].map(([name, pdf, csv]) => (
                  <tr key={name as string} className="hover:bg-gray-50">
                    <td className="border border-gray-300 px-3 py-2 font-medium">{name as string}</td>
                    <td className="border border-gray-300 px-3 py-2 text-center">{pdf ? '○' : '-'}</td>
                    <td className="border border-gray-300 px-3 py-2 text-center">{csv ? '○' : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className="text-lg font-semibold text-gray-700">突合フロー</h3>
          <div className="flex items-center gap-2 flex-wrap text-sm">
            {['月度選択', '売上抽出', '請求書アップロード', '名前マッチング', '粗利確認', 'CSV出力', '確定'].map((step, i, arr) => (
              <React.Fragment key={step}>
                <span className="bg-teal-100 text-teal-800 px-3 py-1 rounded-full font-medium">{step}</span>
                {i < arr.length - 1 && <span className="text-gray-400">→</span>}
              </React.Fragment>
            ))}
          </div>

          <h3 className="text-lg font-semibold text-gray-700">3つの確認タブ</h3>
          <div className="space-y-3">
            {[
              { name: '突合済み', color: 'bg-green-50 border-green-200 text-green-800', desc: '売上と仕入が紐づいた明細。附属品（サイドレール等）は「┗」マークで表示。' },
              { name: '売上のみ', color: 'bg-blue-50 border-blue-200 text-blue-800', desc: '仕入データのない売上（粗利＝売上額）。' },
              { name: '仕入のみ', color: 'bg-yellow-50 border-yellow-200 text-yellow-800', desc: '売上データのない仕入。要確認。' },
            ].map(({ name, color, desc }) => (
              <div key={name} className={`border rounded-lg p-3 ${color}`}>
                <div className="font-semibold mb-1">{name}</div>
                <div className="text-sm opacity-90">{desc}</div>
              </div>
            ))}
          </div>

          <h3 className="text-lg font-semibold text-gray-700">よくある確認ポイント</h3>
          <ul className="space-y-1 text-gray-600 text-sm">
            <li>・ 請求書合計金額とOCR読み取り合計が一致しているか（画面上に差額表示）</li>
            <li>・ 「仕入のみ」タブに大量の未紐づけデータが残っていないか</li>
            <li>・ 翌月に持ち越される前に月次確定まで完了させること</li>
          </ul>
        </div>
      ),
    },
    {
      id: 'receipt-check',
      title: 'レセプトチェック',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15a2.25 2.25 0 0 1 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z" />
        </svg>
      ),
      content: (
        <div className="space-y-6">
          <h2 className="text-2xl font-bold text-gray-800">レセプトチェック</h2>
          <p className="text-gray-600">介護保険レンタルの請求前に、請求内容を確認するチェックリスト機能です。</p>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-blue-700 text-sm">事業所を切り替えてもデータは消えません（保存キーは「全事業所」固定）。</p>
          </div>

          <h3 className="text-lg font-semibold text-gray-700">基本操作フロー</h3>
          <ol className="space-y-2 text-gray-600">
            {[
              '月度・事業所を選択',
              '「データ取込」ボタンをクリック → 介護保険レンタル利用者を自動取込',
              'チェックリストを確認・入力',
              '月度更新（解約利用者を除外）',
              '「CSV出力」ボタンで保存',
            ].map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 bg-rose-500 text-white rounded-full flex items-center justify-center text-xs font-bold">{i + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>

          <h3 className="text-lg font-semibold text-gray-700">チェックリスト列の説明</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-100">
                  <th className="border border-gray-300 px-3 py-2 text-left">列</th>
                  <th className="border border-gray-300 px-3 py-2 text-left">内容</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['利用者名', 'クリックで利用者詳細へ'],
                  ['事業所・拠点', 'Tab1の設定から自動取得'],
                  ['居宅介護支援事業所', 'Tab1の設定から自動取得'],
                  ['単位数', '直接入力可能（再取込時も保持）'],
                  ['入院日・退院日・解約日', '変更情報から自動抽出'],
                  ['各チェック項目', 'クリックで ON/OFF（自動保存）'],
                ].map(([col, desc]) => (
                  <tr key={col} className="hover:bg-gray-50">
                    <td className="border border-gray-300 px-3 py-2 font-medium">{col}</td>
                    <td className="border border-gray-300 px-3 py-2 text-gray-600">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ),
    },
    {
      id: 'ai-features',
      title: 'AI機能',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456Z" />
        </svg>
      ),
      content: (
        <div className="space-y-6">
          <h2 className="text-2xl font-bold text-gray-800">AI機能</h2>
          <p className="text-gray-600">WelfareAssist Proには4つのAI機能が搭載されています。いずれもGemini AIを使用します。</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              { title: 'AI議事録生成', location: '利用者詳細 Tab3', desc: '担当者会議・訪問記録のメモを正式議事録に自動変換。' },
              { title: '医療文書OCR', location: '利用者詳細 Tab2', desc: '診断書・処方箋などを読み取りテキスト化。' },
              { title: '請求書OCR', location: '売上・仕入突合', desc: 'PDF請求書から利用者名・金額を自動抽出。' },
              { title: '福祉用具提案', location: '利用者詳細 Tab5', desc: '利用者の状況から適切な福祉用具を提案。' },
            ].map(({ title, location, desc }) => (
              <div key={title} className="border border-gray-200 rounded-lg p-4">
                <div className="font-semibold text-gray-800 mb-1">{title}</div>
                <div className="text-xs text-gray-500 mb-2">{location}</div>
                <div className="text-sm text-gray-600">{desc}</div>
              </div>
            ))}
          </div>

          <h3 className="text-lg font-semibold text-gray-700">AI議事録の出力フォーマット</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-100">
                  <th className="border border-gray-300 px-3 py-2 text-left">種別</th>
                  <th className="border border-gray-300 px-3 py-2 text-left">出力項目</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['担当者会議・カンファレンス', '会議目的 / 出席者・所属 / 利用者の現状 / 協議内容 / 決定事項 / 今後の対応・役割分担 / 次回予定 / 特記事項'],
                  ['その他（訪問等）', '訪問日時 / 訪問目的 / 利用者の状態 / 確認事項 / 対応内容 / 今後の予定 / 特記事項'],
                ].map(([type, items]) => (
                  <tr key={type} className="hover:bg-gray-50">
                    <td className="border border-gray-300 px-3 py-2 font-medium whitespace-nowrap">{type}</td>
                    <td className="border border-gray-300 px-3 py-2 text-gray-600 text-xs">{items}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <h4 className="font-semibold text-yellow-800 mb-1">AI生成に失敗する場合</h4>
            <ul className="text-yellow-700 text-sm space-y-1">
              <li>・ ネットワーク接続を確認してください</li>
              <li>・ 生成には30〜60秒かかります。途中でページを離れないでください</li>
              <li>・ エラーが続く場合は手動入力に切り替えてください</li>
            </ul>
          </div>
        </div>
      ),
    },
    {
      id: 'bed-inventory',
      title: 'ベッド管理',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" />
        </svg>
      ),
      content: (
        <div className="space-y-6">
          <h2 className="text-2xl font-bold text-gray-800">ベッド管理</h2>
          <p className="text-gray-600">自社所有のベッド・サイドレール・マットレスの在庫・貸出・QR管理・償却・クリーニング・監査ログを管理します。</p>

          <h3 className="text-lg font-semibold text-gray-700">4つのタブ</h3>
          <div className="space-y-2">
            {[
              { name: '在庫一覧', desc: '全アイテムの一覧・ステータス管理・状態変更操作' },
              { name: 'セット管理', desc: '複数アイテムをセットとして管理・一括操作' },
              { name: '償却・クリーニング', desc: '12ヶ月償却計算・クリーニング記録' },
              { name: '監査ログ', desc: '全ステータス変更の履歴（追記専用）' },
            ].map(({ name, desc }) => (
              <div key={name} className="flex gap-3 p-3 bg-indigo-50 border border-indigo-200 rounded-lg">
                <span className="font-semibold text-indigo-800 whitespace-nowrap">{name}</span>
                <span className="text-indigo-700 text-sm">{desc}</span>
              </div>
            ))}
          </div>

          <h3 className="text-lg font-semibold text-gray-700">ステータスの種類（9種類）</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-100">
                  <th className="border border-gray-300 px-3 py-2 text-left">ステータス</th>
                  <th className="border border-gray-300 px-3 py-2 text-left">意味</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['倉庫保管', '倉庫に保管中（使用可能）'],
                  ['事務所保管', '事務所に保管中（使用可能）'],
                  ['クリーニング前', '返却後、クリーニング待ち'],
                  ['クリーニング中', 'クリーニング処理中'],
                  ['介護保険貸与にて使用', '介護保険レンタルで利用者に貸出中'],
                  ['自費にて使用', '自費レンタルで利用者に貸出中'],
                  ['施設物品', '施設の備品として使用中'],
                  ['販売済み', '利用者に販売済み'],
                  ['破棄済み', '廃棄処分済み'],
                ].map(([status, desc]) => (
                  <tr key={status} className="hover:bg-gray-50">
                    <td className="border border-gray-300 px-3 py-2 font-medium">{status}</td>
                    <td className="border border-gray-300 px-3 py-2 text-gray-600">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm text-gray-600">
            次に遷移できるステータスは「用途区分（介護保険/自費/販売/施設物品/使用不可）× 現在のステータス」の組み合わせで自動的に絞り込まれます。
          </div>

          <h3 className="text-lg font-semibold text-gray-700">QRコード</h3>
          <p className="text-gray-600 text-sm">各アイテムにQRコードを発行・印刷できます。「QRスキャン」ボタンでカメラからQRを読み取り、アイテムを素早く検索できます。</p>
          <ol className="space-y-1 text-gray-600 text-sm">
            {['カメラへのアクセスを許可', 'QRコードを枠内に収める', '自動で読み取り完了（操作不要）'].map((step, i) => (
              <li key={i} className="flex gap-2"><span className="font-bold text-indigo-600">{i + 1}.</span>{step}</li>
            ))}
          </ol>

          <h3 className="text-lg font-semibold text-gray-700">12ヶ月償却 レンタル先一覧</h3>
          <p className="text-gray-600 text-sm">「償却・クリーニング」タブの最上部に、12ヶ月償却アイテムのレンタル先一覧を表示します。残存簿価は購入日の経過日数ではなく<strong>実際のレンタル月数</strong>をもとに計算します。</p>

          <h3 className="text-lg font-semibold text-gray-700">償却計算</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-100">
                  <th className="border border-gray-300 px-3 py-2 text-left">項目</th>
                  <th className="border border-gray-300 px-3 py-2 text-left">内容</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['月額償却', '購入金額 ÷ 償却月数'],
                  ['累計償却額', '実レンタル月数 × 月額償却'],
                  ['残存簿価', '購入金額 − 累計償却額'],
                ].map(([item, content]) => (
                  <tr key={item} className="hover:bg-gray-50">
                    <td className="border border-gray-300 px-3 py-2 font-medium">{item}</td>
                    <td className="border border-gray-300 px-3 py-2 text-gray-600 font-mono text-xs">{content}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800">
            スマートフォン・タブレットではカード形式、デスクトップではテーブル形式で表示されます。
          </div>
        </div>
      ),
    },
    {
      id: 'change-records',
      title: '変更情報一覧',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM3.75 12h.007v.008H3.75V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm-.375 5.25h.007v.008H3.75v-.008Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
        </svg>
      ),
      content: (
        <div className="space-y-6">
          <h2 className="text-2xl font-bold text-gray-800">変更情報一覧</h2>
          <p className="text-gray-600">新規・入院・退院・解約などの変更情報を横断的に確認し、CSVやスプレッドシートに出力する機能です。</p>

          <h3 className="text-lg font-semibold text-gray-700">フィルター設定</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-100">
                  <th className="border border-gray-300 px-3 py-2 text-left">フィルター</th>
                  <th className="border border-gray-300 px-3 py-2 text-left">説明</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['開始日・終了日', '対象期間を指定'],
                  ['事業所', '全事業所または特定の事業所'],
                  ['情報種別', '新規・入院・退院・解約・変更あり・その他・デモ'],
                ].map(([filter, desc]) => (
                  <tr key={filter} className="hover:bg-gray-50">
                    <td className="border border-gray-300 px-3 py-2 font-medium">{filter}</td>
                    <td className="border border-gray-300 px-3 py-2 text-gray-600">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className="text-lg font-semibold text-gray-700">情報種別の説明</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-100">
                  <th className="border border-gray-300 px-3 py-2 text-left">種別</th>
                  <th className="border border-gray-300 px-3 py-2 text-left">主な使いどき</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['新規', '新規利用者の請求開始時'],
                  ['入院（サービス停止）', '入院による福祉用具レンタル一時停止時'],
                  ['退院（サービス開始）', '退院後の再開時'],
                  ['解約', 'レンタル解約時'],
                  ['変更あり', '用具変更・ケアマネ変更など'],
                  ['その他', '上記に当てはまらない変更'],
                  ['デモ', '用具のデモ貸出期間を記録（デモ開始日・終了日）'],
                ].map(([type, desc]) => (
                  <tr key={type} className="hover:bg-gray-50">
                    <td className="border border-gray-300 px-3 py-2 font-medium">{type}</td>
                    <td className="border border-gray-300 px-3 py-2 text-gray-600">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className="text-lg font-semibold text-gray-700">スプレッドシート出力（追記モード）</h3>
          <div className="space-y-2 text-sm text-gray-600">
            <p>「スプレッドシートに書き出し」ボタンで Googleスプレッドシートに直接出力できます。</p>
            <ul className="space-y-1">
              <li>・ <strong>初回</strong>：ヘッダー行＋全レコードを書き込み</li>
              <li>・ <strong>2回目以降</strong>：レコードIDをキーに重複確認し、新しいレコードのみ末尾に追記（既存データは上書きされません）</li>
              <li>・ <strong>対象</strong>：2025年11月1日以降のレコードのみ</li>
            </ul>
          </div>

          <h3 className="text-lg font-semibold text-gray-700">よくある使い方</h3>
          <ul className="space-y-1 text-gray-600 text-sm">
            <li>・ 月初に先月分の変更情報をCSV出力 → 請求処理に活用</li>
            <li>・ 卸会社への連絡漏れチェック（卸会社連絡状況列を確認）</li>
            <li>・ レセプトチェック時の入退院情報の照合</li>
            <li>・ スプレッドシートへの追記出力 → 担当者間の情報共有・履歴管理</li>
          </ul>
        </div>
      ),
    },
  ];

  const activeContent = sections.find(s => s.id === activeSection);

  return (
    <div className="flex h-full bg-white">
      {/* Left nav */}
      <div className="w-56 flex-shrink-0 border-r border-gray-200 bg-gray-50 overflow-y-auto">
        <div className="p-4 border-b border-gray-200">
          <h1 className="font-bold text-gray-800 text-base">ヘルプ</h1>
          <p className="text-xs text-gray-500 mt-0.5">WelfareAssist Pro</p>
        </div>
        <nav className="p-2">
          {sections.map((section) => (
            <button
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm text-left transition-colors mb-0.5 ${
                activeSection === section.id
                  ? 'bg-blue-100 text-blue-800 font-semibold'
                  : 'text-gray-700 hover:bg-gray-200'
              }`}
            >
              <span className="flex-shrink-0">{section.icon}</span>
              <span>{section.title}</span>
            </button>
          ))}
        </nav>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-3xl">
          {activeContent?.content}
        </div>
      </div>
    </div>
  );
};

export default HelpPage;
