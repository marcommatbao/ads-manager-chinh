"""Installed Playwright only; no server. Run after Vitest fixture preparation + Vite bundle.
Usage: <python-with-playwright> tests/fixtures/run-review-recovery-hydrated.py <chromium-path>
All browser requests are intercepted; fetch is stateful synthetic memory only.
"""
import json
import pathlib
import sys
from playwright.sync_api import sync_playwright, expect

root = pathlib.Path(__file__).resolve().parent / 'local/review-recovery'
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=sys.argv[1], headless=True)
    page = browser.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    def serve(route):
        url = route.request.url
        assert url.startswith('http://fixture.test/'), url
        name = url.removeprefix('http://fixture.test/')
        assert name == 'fixture.js' or name in [f'{l}-{m}.html' for l in ['vi', 'en'] for m in ['review', 'viewer', 'conflict', 'error503', 'recovery200', 'recovery409', 'recovery503']], url
        route.fulfill(body=(root / name).read_bytes(), content_type='text/javascript' if name.endswith('.js') else 'text/html')
    page.route('**/*', serve)
    passed = []
    for locale in ['en', 'vi']:
        review = 'Record content review' if locale == 'en' else 'Ghi nhận đã rà soát'
        cancel = 'Cancel' if locale == 'en' else 'Hủy'
        save = 'Save new revision' if locale == 'en' else 'Lưu phiên bản mới'
        usp = 'USP' if locale == 'en' else 'Điểm khác biệt'
        reload = 'Reload current brief' if locale == 'en' else 'Tải lại brief hiện tại'
        def open_mode(mode):
            page.goto(f'http://fixture.test/{locale}-{mode}.html')
            page.wait_for_function('window.ready === true')
        def calls():
            return page.evaluate('window.calls')
        def dialog():
            page.get_by_role('button', name=review, exact=True).click()
            d = page.get_by_role('dialog')
            expect(d).to_be_visible()
            expect(d.get_by_role('checkbox')).not_to_be_checked()
            expect(d.get_by_role('button', name=review, exact=True)).to_be_disabled()
            return d
        open_mode('review')
        page.get_by_role('textbox', name=usp, exact=True).fill('unsaved')
        expect(page.get_by_role('button', name=review, exact=True)).to_be_disabled()
        assert calls() == []
        page.get_by_role('textbox', name=usp, exact=True).fill('original')
        d = dialog()
        d.get_by_role('checkbox').check()
        d.get_by_role('button', name=cancel, exact=True).click()
        expect(page.get_by_role('dialog')).to_have_count(0)
        assert calls() == []
        d = dialog()
        page.keyboard.press('Escape')
        expect(page.get_by_role('dialog')).to_have_count(0)
        assert calls() == []
        d = dialog()
        d.get_by_role('checkbox').check()
        d.get_by_role('button', name=review, exact=True).click()
        expect(page.get_by_role('dialog')).to_have_count(0)
        expect(page.locator('section > p').filter(has_text='server-reviewer')).to_be_visible()
        assert calls() == [{'url': '/api/creative/brief/fixture-draft', 'method': 'PATCH', 'body': {'action': 'review', 'company': 'MBC', 'expectedRevision': 1, 'contentHash': 'fixture-hash', 'usp': 'original', 'valueProposition': 'value'}}]
        before = page.evaluate('JSON.stringify(window.serverDraft.history[0])')
        page.get_by_role('textbox', name=usp, exact=True).fill('edited by human')
        expect(page.get_by_role('button', name=review, exact=True)).to_be_disabled()
        page.get_by_role('button', name=save, exact=True).click()
        expect(page.get_by_role('textbox', name=usp, exact=True)).to_have_value('edited by human')
        expect(page.locator('section > p[role=status]').first).to_have_text('Revision 2 · Unreviewed' if locale == 'en' else 'Phiên bản 2 · Chưa rà soát')
        expect(page.get_by_role('button', name=review, exact=True)).to_be_enabled()
        state = page.evaluate('window.serverDraft')
        assert state.get('review') is None and len(state['history']) == 2
        assert page.evaluate('JSON.stringify(window.serverDraft.history[0])') == before
        page.locator('section > details > summary').click()
        expect(page.locator('section > details > details')).to_have_count(2)
        assert calls()[1]['body']['action'] == 'edit' and calls()[1]['body']['expectedRevision'] == 1
        passed.append(f'{locale}:review_cancel_escape_confirm_edit_history')
        open_mode('viewer')
        expect(page.get_by_role('button')).to_have_count(0)
        expect(page.get_by_role('textbox')).to_have_count(0)
        assert calls() == []
        for mode in ['conflict', 'error503']:
            open_mode(mode)
            d = dialog()
            d.get_by_role('checkbox').check()
            d.get_by_role('button', name=review, exact=True).click()
            expect(page.get_by_role('alert')).to_be_visible()
            assert not page.evaluate('Boolean(window.serverDraft.review)')
            if mode == 'conflict':
                expect(page.get_by_role('alert')).to_contain_text('changed' if locale == 'en' else 'thay đổi')
                expect(page.get_by_role('button', name=review, exact=True)).to_be_disabled()
                assert len(calls()) == 1  # no automatic write retry or reload
                page.get_by_role('button', name=reload, exact=True).click()
                expect(page.get_by_role('textbox', name=usp, exact=True)).to_have_value('server-current-usp')
                assert calls()[-1]['method'] == 'GET'
                d = dialog()
                expect(d).to_contain_text('server-current-hash')
                page.keyboard.press('Escape')
            else:
                expect(page.get_by_role('dialog')).to_be_visible()
                assert len(calls()) == 1
        passed.append(f'{locale}:viewer_409_explicit_refetch_503_no_success')
        for status in [200, 409, 503]:
            open_mode(f'recovery{status}')
            check = page.get_by_role('checkbox')
            button = page.get_by_role('button')
            expect(check).not_to_be_checked()
            expect(button).to_be_disabled()
            check.check()
            expect(button).to_be_enabled()
            check.uncheck()  # cancel acknowledgement before dispatch
            expect(button).to_be_disabled()
            assert calls() == [] and not page.evaluate('window.recovered')
            check.check()
            button.click()
            expect(page.get_by_role('status')).to_be_visible()
            assert page.evaluate('window.recovered') == (status == 200)
            text = page.get_by_role('status').inner_text()
            assert ('refresh' in text.lower() if locale == 'en' else 'tải lại' in text.lower()) if status == 200 else ('refused or unavailable' in text if locale == 'en' else 'Không thể' in text)
            assert calls() == [{'url': '/api/jobs/quality_checkpoint/recover', 'method': 'POST', 'body': {'runId': 'synthetic-crashed-run', 'expectedStartedAt': '2026-11-27T00:58:59.999Z'}}]
        passed.append(f'{locale}:recovery_clear_200_409_503')
    assert not errors, errors
    print(json.dumps({'passed': passed, 'page_errors': errors, 'network': 'all intercepted; stateful synthetic boundary'}))
    browser.close()
