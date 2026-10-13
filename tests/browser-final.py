"""Final UI checks using synthetic data only. Never point this at a live office DB."""
from pathlib import Path
import argparse, json, subprocess, time, traceback, urllib.request, uuid
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser(description='UI regression checks using a new isolated database and synthetic data only.')
parser.add_argument('--out',type=Path,default=ROOT/'.test-data'/'browser-final')
parser.add_argument('--port',type=int,default=43181)
parser.add_argument('--chromium',default='/usr/bin/chromium' if Path('/usr/bin/chromium').is_file() else None)
args=parser.parse_args()
if not 1024 <= args.port <= 65535:parser.error('port must be 1024-65535')
OUT=args.out.resolve()
OUT.mkdir(parents=True,exist_ok=True)
(OUT/'screens').mkdir(exist_ok=True)
URL=f'http://127.0.0.1:{args.port}' 
USERNAME='final-verifier'
PASSWORD='FinalUiOnly-2026!'
NEW_PASSWORD='FinalUiChanged-2026!'
report={'checks':[],'page_errors':[],'unexpected_console_errors':[]}
tokens={}

def check(name):
    report['checks'].append({'name':name,'passed':True})
    print(name+' PASS',flush=True)

def state(key='a'):
    req=urllib.request.Request(URL+'/api/state',headers={'Authorization':'Bearer '+tokens[key]})
    with urllib.request.urlopen(req) as r:return json.load(r)

fixture_script="\nimport {writeFile} from 'node:fs/promises';\nimport {createCareServer} from './server/server.mjs';\nconst app=await createCareServer({port:0});let token='';\nconst call=async(path,method='GET',body)=>{const r=await fetch(app.url+path,{method,headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const data=await r.json();if(!r.ok)throw new Error(`${path}: ${r.status}`);return data;};\ntry{\n const account=await call('/api/setup','POST',{username:'fixture-only',displayName:'検証用',password:'FixtureOnly2026!',facilityName:'復元検証事業所'});token=account.token;\n const state=await call('/api/state');await call('/api/settings','PUT',{revision:state.settings.revision,settings:{...state.settings,facilityName:'復元検証事業所',targetMonth:'2026-10',authors:['検証作成者A','検証作成者B'],meeting1Date:'2026-10-16',meeting2Date:'2026-10-23',meeting1Time:'14:15',meeting2Time:'14:30'}});\n for(let n=1;n<=2;n++){const resident=await call('/api/residents','POST',{resident:{chartNumber:`FIX-${n}`,room:n===1?'601':'611',name:`復元検証利用者${n}`,creationMonth:'2026-10',planStartMonth:'2026-11',planEndMonth:'2027-01',certificationExpiryMonth:'2027-06',restraint:n===2}});await call('/api/plans','POST',{plan:{residentId:resident.id,targetMonth:'2026-10',meetingRound:n,meetingDate:n===1?'2026-10-16':'2026-10-23'}});}\n await writeFile(process.argv[2],JSON.stringify(await call('/api/backup'),null,2));\n}finally{await app.close();}\n"
subprocess.run(['node','--input-type=module','-',str(OUT/'synthetic-backup.json')],input=fixture_script,text=True,cwd=ROOT,check=True)

server=subprocess.Popen(['node','server/server.mjs','--data-dir',str(OUT/('db-'+uuid.uuid4().hex)),'--port',str(args.port),'--static-dir',str(ROOT/'dist')],cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
try:
    for _ in range(100):
        if server.poll() is not None:raise RuntimeError('Isolated UI server could not start')
        try:
            with urllib.request.urlopen(URL+'/api/health') as r:
                if json.load(r)['ok']:break
        except OSError:time.sleep(.05)
    else:raise RuntimeError('Isolated UI server did not become ready')
    with sync_playwright() as p:
        browser=p.chromium.launch(**({'executable_path':args.chromium} if args.chromium else {}),headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
        def new_page(key):
            ctx=browser.new_context(viewport={'width':1500,'height':1050},locale='ja-JP',timezone_id='Asia/Tokyo')
            page=ctx.new_page();page.set_default_timeout(15000)
            def request_seen(req):
                if req.url.endswith('/api/state'):
                    authorization=req.headers.get('authorization','')
                    if authorization.startswith('Bearer '):tokens[key]=authorization[7:]
            page.on('request',request_seen)
            page.on('pageerror',lambda err:report['page_errors'].append(str(err)))
            # Deliberately failing 400/409 operations are expected and recorded below.
            page.on('console',lambda msg:report['unexpected_console_errors'].append(msg.text) if msg.type=='error' and not any(code in msg.text for code in ('400','409')) else None)
            return page
        page=new_page('a')
        def nav(page,label):
            page.locator('nav').get_by_role('button',name=label,exact=False).click()
            expect(page.locator('.page-heading h1')).to_have_text(label)
        def close_toast(page):
            button=page.get_by_role('button',name='通知を閉じる')
            if button.count():button.click()
        def login(page,password=PASSWORD):
            page.get_by_label('ユーザー名',exact=False).fill(USERNAME)
            page.get_by_label('パスワード',exact=False).fill(password)
            page.get_by_role('button',name='ログイン',exact=True).click()
            expect(page.locator('.app-shell')).to_be_visible()
        def save_settings(page):
            close_toast(page)
            page.get_by_role('button',name='設定を保存',exact=True).click()
            expect(page.locator('.toast')).to_contain_text('事業所設定を保存しました')
            close_toast(page)

        page.goto(URL,wait_until='networkidle')
        page.get_by_label('事業所名',exact=False).fill('初回検証事業所')
        page.get_by_label('管理者の表示名',exact=False).fill('最終検証管理者')
        page.get_by_label('ユーザー名',exact=False).fill(USERNAME)
        page.get_by_label('パスワード',exact=False).fill(PASSWORD)
        page.get_by_role('button',name='登録してはじめる').click()
        expect(page.locator('.app-shell')).to_be_visible()
        check('Initial setup in packaged production UI')

        nav(page,'事業所設定')
        page.get_by_label('フロア',exact=False).fill('6階')
        save_settings(page)
        page.get_by_label('連絡先電話番号',exact=False).fill('000-0000-0000')
        save_settings(page)
        assert state()['settings']['floor']=='6階'
        assert state()['settings']['contactPhone']=='000-0000-0000'
        check('Consecutive settings saves refresh the editing revision')

        page.get_by_role('button',name='職員を追加').click()
        dialog=page.locator('dialog')
        dialog.get_by_label('表示名',exact=False).fill('検証スタッフ')
        dialog.get_by_label('ユーザー名',exact=False).fill('test-staff')
        dialog.get_by_label('初期パスワード',exact=False).fill('TestStaffOnly-2026!')
        dialog.get_by_role('button',name='登録する',exact=True).click()
        expect(page.locator('dialog')).to_have_count(0)
        close_toast(page)
        page.get_by_role('button',name='職員を追加').click()
        dialog=page.locator('dialog')
        dialog.get_by_label('表示名',exact=False).fill('重複検証')
        dialog.get_by_label('ユーザー名',exact=False).fill('test-staff')
        dialog.get_by_label('初期パスワード',exact=False).fill('TestStaffOnly-2026!')
        dialog.get_by_role('button',name='登録する',exact=True).click()
        expect(page.locator('.modal-notice')).to_be_visible()
        expect(page.locator('.modal-notice')).to_contain_text('使用済み')
        expect(dialog).to_be_visible()
        expect(dialog.get_by_label('ユーザー名',exact=False)).to_have_value('test-staff')
        dialog.get_by_role('button',name='キャンセル',exact=True).click()
        close_toast(page)
        check('Duplicate account error keeps the form and entered values')

        expect(page.get_by_role('button',name='バックアップから復元',exact=True)).to_be_enabled()
        page.locator('input[type=file][accept=".json"]').set_input_files(str(OUT/'synthetic-backup.json'))
        expect(page.locator('dialog')).to_contain_text('バックアップの復元内容を確認')
        page.locator('dialog').get_by_role('button',name='確認して復元する',exact=True).click()
        expect(page.locator('dialog')).to_have_count(0)
        expect(page.locator('.toast')).to_contain_text('バックアップから復元しました')
        data=state();assert len(data['residents'])==2 and len(data['plans'])==2 and len(data['users'])==2
        expect(page.get_by_role('button',name='バックアップから復元',exact=True)).to_be_disabled()
        close_toast(page)
        check('Backup restore UI preserves accounts and restores linked records')

        nav(page,'利用者台帳')
        for n,room in [(1,'603'),(2,'612')]:
            page.get_by_role('button',name='利用者を登録',exact=True).click()
            dialog=page.locator('dialog')
            dialog.get_by_label('カルテ番号 *',exact=False).fill(f'NEW-{n}')
            dialog.get_by_label('利用者氏名 *',exact=False).fill(f'追加検証利用者{n}')
            dialog.get_by_label('居室',exact=True).fill(room)
            dialog.get_by_label('プラン作成年月',exact=False).fill('2026-10')
            dialog.get_by_label('ケアプラン開始年月',exact=False).fill('2026-11')
            dialog.get_by_label('ケアプラン満了年月',exact=False).fill('2027-01')
            dialog.get_by_label('認定期限（年月）',exact=False).fill('2027-06')
            if n==1:
                dialog.get_by_label('ケアプラン満了年月',exact=False).fill('2026-10')
                dialog.get_by_role('button',name='保存する',exact=True).click()
                expect(page.locator('.modal-notice')).to_be_visible()
                expect(page.locator('.modal-notice')).to_contain_text('開始月以降')
                expect(dialog).to_be_visible()
                dialog.get_by_label('ケアプラン満了年月',exact=False).fill('2027-01')
                close_toast(page)
            dialog.get_by_role('button',name='保存する',exact=True).click()
            expect(page.locator('dialog')).to_have_count(0)
            expect(page.get_by_role('button',name=f'追加検証利用者{n}',exact=True)).to_be_visible()
            close_toast(page)
        check('Invalid resident period is rejected without losing the editing form')
        nav(page,'ケアプラン管理')
        page.get_by_label('対象年月',exact=False).fill('2026-10')
        page.get_by_role('button',name='対象者から一括作成',exact=True).click()
        dialog=page.locator('dialog')
        dialog.get_by_label('会議グループへの振り分け',exact=False).select_option('balanced')
        dialog.get_by_role('button',name='確認して2件を作成',exact=True).click()
        expect(page.locator('dialog')).to_have_count(0)
        expect(page.locator('.toast')).to_contain_text('ケアプランを作成しました')
        data=state();new_ids={r['id'] for r in data['residents'] if r['chartNumber'].startswith('NEW-')}
        new_plans=[r for r in data['plans'] if r['residentId'] in new_ids]
        assert len(new_plans)==2 and sorted(r['meetingRound'] for r in new_plans)==[1,2]
        check('Balanced batch UI splits new residents into both meeting groups')
        close_toast(page)

        other=new_page('b');other.goto(URL,wait_until='networkidle');login(other)
        for current in [page,other]:
            nav(current,'利用者台帳')
            current.get_by_role('button',name='追加検証利用者1',exact=True).click()
        page.locator('dialog').get_by_role('textbox',name='備考',exact=True).fill('職員Aの更新')
        other.locator('dialog').get_by_role('textbox',name='備考',exact=True).fill('職員Bの未保存入力')
        page.locator('dialog').get_by_role('button',name='保存する',exact=True).click()
        expect(page.locator('dialog')).to_have_count(0)
        other.locator('dialog').get_by_role('button',name='保存する',exact=True).click()
        expect(other.locator('.modal-notice')).to_be_visible()
        expect(other.locator('.modal-notice')).to_contain_text('他の職員')
        expect(other.locator('dialog').get_by_role('textbox',name='備考',exact=True)).to_have_value('職員Bの未保存入力')
        other.locator('dialog').get_by_role('button',name='キャンセル',exact=True).click()
        close_toast(other);close_toast(page)
        assert next(r for r in state()['residents'] if r['chartNumber']=='NEW-1')['notes']=='職員Aの更新'
        check('Two users cannot overwrite resident changes and the losing edit remains')

        for current in [page,other]:nav(current,'事業所設定')
        page.get_by_label('事業所名',exact=True).fill('職員Aの事業所設定')
        other.get_by_label('フロア',exact=False).fill('職員Bのフロア')
        save_settings(page)
        other.get_by_role('button',name='設定を保存',exact=True).click()
        expect(other.locator('.toast')).to_contain_text('他の職員')
        expect(other.get_by_label('フロア',exact=False)).to_have_value('職員Bのフロア')
        assert state()['settings']['floor']!='職員Bのフロア'
        other.get_by_role('button',name='編集を破棄して再読込',exact=True).click()
        expect(other.get_by_label('事業所名',exact=True)).to_have_value('職員Aの事業所設定')
        other.get_by_label('フロア',exact=False).fill('7階')
        save_settings(other)
        assert state('b')['settings']['floor']=='7階'
        check('Stale office settings are protected and explicit reload permits retry')

        other.context.close()
        page.get_by_role('button',name='最新データを取得').click()
        expect(page.locator('.toast')).to_contain_text('最新のデータを取得しました')
        close_toast(page)
        page.get_by_role('button',name='最終検証管理者のアカウントを編集',exact=True).click()
        dialog=page.locator('dialog')
        dialog.get_by_label('新しいパスワード',exact=False).fill(NEW_PASSWORD)
        dialog.get_by_role('button',name='保存する',exact=True).click()
        expect(page.locator('.auth-card')).to_be_visible()
        expect(page.locator('.auth-card')).to_contain_text('アカウントを更新しました')
        login(page,NEW_PASSWORD)
        assert len(state()['residents'])==4
        check('Own password change signs out cleanly and the new password works')
        nav(page,'ダッシュボード')
        page.screenshot(path=str(OUT/'screens/dashboard.png'),full_page=True)
        nav(page,'利用者台帳')
        page.screenshot(path=str(OUT/'screens/residents.png'),full_page=True)
        assert not report['page_errors']
        assert not report['unexpected_console_errors'],report['unexpected_console_errors']
        check('Production UI has no unexpected page or console errors')
        report['passed']=True
        browser.close()
except Exception:
    report['passed']=False
    report['failure']=traceback.format_exc()
    raise
finally:
    (OUT/'final-ui-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    server.terminate()
    try:server.wait(timeout=10)
    except subprocess.TimeoutExpired:server.kill();server.wait()
