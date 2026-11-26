"""Use an already installed Playwright Python + Chromium. No server or network.
Usage: <python-with-playwright> tests/fixtures/run-quality-hydrated.py <chromium-path>
Prepare: npx vitest run tests/quality-hydrated-fixture.test.tsx
         node tests/fixtures/build-quality-hydrated.mjs
"""
import json
import pathlib
import sys
from playwright.sync_api import sync_playwright, expect

root = pathlib.Path('/tmp/ads-quality-hydrated')
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=sys.argv[1], headless=True)
    page = browser.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    # A virtual origin served exclusively from local generated fixture files.
    def serve(route):
        name = 'fixture.js' if route.request.url.endswith('/fixture.js') else 'index.html'
        if not route.request.url.startswith('http://fixture.test/'):
            raise AssertionError('unexpected network request')
        route.fulfill(body=(root / name).read_bytes(), content_type='text/javascript' if name.endswith('.js') else 'text/html')
    page.route('**/*', serve)
    def open_mode(mode):
        page.goto('http://fixture.test/?mode=' + mode)
        page.wait_for_function('window.ready === true')
    open_mode('proposed')
    page.get_by_role('button', name='Record', exact=False).click()
    page.wait_for_function("window.calls.some(c => c.body?.operation === 'record')")
    open_mode('recorded')
    cycle = page.get_by_role('button', name='cycle', exact=False)
    page.on('dialog', lambda dialog: dialog.dismiss())
    cycle.click()
    assert not page.evaluate("window.calls.some(c => c.body?.operation === 'new_cycle')")
    # Reset the page to remove the dismissal listener deterministically.
    page.close()
    page = browser.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.route('**/*', serve)
    open_mode('recorded')
    page.on('dialog', lambda dialog: dialog.accept())
    page.get_by_role('button', name='cycle', exact=False).click()
    page.wait_for_function("window.calls.some(c => c.body?.operation === 'new_cycle' && c.body.confirmed === true)")
    open_mode('conflict')
    page.get_by_role('button', name='Read snapshot and observe', exact=False).click()
    expect(page.get_by_role('alert')).to_be_visible()
    calls = page.evaluate('window.calls')
    assert any(c['url'].startswith('/api/inbox/quality?') for c in calls)
    assert any(c.get('body', {}).get('expectedRevision') == 'synthetic-revision' for c in calls if c.get('body'))
    assert sum(c['url'] == '/api/inbox' for c in calls) >= 2
    open_mode('viewer')
    expect(page.get_by_role('button')).to_have_count(1)  # refresh only
    open_mode('loading')
    expect(page.get_by_role('status')).to_be_visible()
    expect(page.get_by_role('button')).to_be_disabled()
    open_mode('error')
    expect(page.get_by_role('alert')).to_be_visible()
    assert not errors, errors
    print(json.dumps({'passed': True, 'scenarios': ['record', 'newcycle_cancel', 'newcycle_confirm', 'observe409_refresh', 'viewer', 'loading', 'error'], 'page_errors': errors, 'network': 'all intercepted; synthetic only'}))
    browser.close()
