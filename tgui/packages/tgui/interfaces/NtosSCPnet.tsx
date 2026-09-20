import { Component } from 'inferno';
import { useBackend, useLocalState } from '../backend';
import { Box, Button, Icon, Input, NoticeBox, Section, Stack } from '../components';
import { NtosWindow } from '../layouts';

const FRAME_ADDRESS =
  /^https:\/\/[a-z0-9.-]{4,64}\/i\/[a-f0-9]{32}\/[a-z0-9][a-z0-9-]{0,62}$/;
const FRAME_SANDBOX = 'allow-scripts';
const FRAME_POLICY = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src https: data:',
  'media-src https:',
  "font-src data:",
  "connect-src 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "worker-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  'sandbox allow-scripts',
].join('; ');
const PROBE_TIMEOUT = 700;
const LAG_TICK = 1000;
const LAG_LIMIT = 4000;
const CSP_PROBE =
  '<meta http-equiv="Content-Security-Policy" content="script-src \'none\'">' +
  '<script>parent.postMessage("scpnet-probe-csp","*")</script>';
const SANDBOX_PROBE =
  '<script>parent.postMessage("scpnet-probe-sandbox","*")</script>';

let rendererCheck: Promise<boolean> | null = null;

const escapes = (): Promise<boolean> =>
  new Promise((resolve) => {
    let settled = false;
    const frames: HTMLIFrameElement[] = [];
    const finish = (leaked: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      window.removeEventListener('message', listener);
      window.clearTimeout(timer);
      for (const frame of frames) {
        frame.remove();
      }
      resolve(leaked);
    };
    const listener = (event: MessageEvent) => {
      if (
        event.data === 'scpnet-probe-csp' ||
        event.data === 'scpnet-probe-sandbox'
      ) {
        finish(true);
      }
    };
    const timer = window.setTimeout(() => finish(false), PROBE_TIMEOUT);
    window.addEventListener('message', listener);
    try {
      const probes: [string, string | null][] = [
        [CSP_PROBE, null],
        [SANDBOX_PROBE, ''],
      ];
      for (const [markup, sandbox] of probes) {
        const frame = document.createElement('iframe');
        frame.style.display = 'none';
        if (sandbox !== null) {
          frame.setAttribute('sandbox', sandbox);
        }
        frame.srcdoc = markup;
        document.body.appendChild(frame);
        frames.push(frame);
      }
    } catch {
      finish(true);
    }
  });

const rendererAllows = (): Promise<boolean> => {
  if (!rendererCheck) {
    rendererCheck = (async () => {
      const frame = document.createElement('iframe');
      if (!('sandbox' in frame) || !('srcdoc' in frame)) {
        return false;
      }
      return !(await escapes());
    })().catch(() => false);
  }
  return rendererCheck;
};

type SitePage = {
  slug: string;
  title: string;
};

type Site = {
  id: string;
  domain: string;
  title: string;
  version: string;
  icon?: string;
  pages: SitePage[];
};

type Page = {
  site_id: string;
  slug: string;
  version: string;
  title: string;
  frame: string | null;
  text: string;
};

type Found = {
  site_id: string;
  slug: string;
  title: string;
  snippet: string;
};

type Data = {
  available: boolean;
  loading: boolean;
  catalog: Site[];
  site: Site | null;
  page: Page | null;
  slug: string | null;
  search: {
    query: string | null;
    results: Found[];
    pending: boolean;
    error: string | null;
  };
  login: {
    code: string | null;
    pending: boolean;
    retry_seconds: number;
    error: string | null;
  };
};

type FrameProps = {
  url: string;
  title: string;
  fallback: any;
};

type FrameState = {
  allowed: boolean | null;
  stopped: boolean;
};

class PageFrame extends Component<FrameProps, FrameState> {
  private alive = true;
  private timer = 0;
  private lastTick = 0;

  constructor(props: FrameProps) {
    super(props);
    this.state = { allowed: null, stopped: false };
  }

  componentDidMount() {
    rendererAllows().then((result) => {
      if (this.alive) {
        this.setState({ allowed: result });
        this.watch();
      }
    });
  }

  componentWillUnmount() {
    this.alive = false;
    window.clearInterval(this.timer);
  }

  watch() {
    window.clearInterval(this.timer);
    if ((this.state as FrameState).allowed !== true) {
      return;
    }
    this.lastTick = Date.now();
    this.timer = window.setInterval(() => {
      const now = Date.now();
      const lag = now - this.lastTick - LAG_TICK;
      this.lastTick = now;
      if (lag > LAG_LIMIT) {
        window.clearInterval(this.timer);
        this.setState({ stopped: true });
      }
    }, LAG_TICK);
  }

  render() {
    const { url, title, fallback } = this.props;
    const { allowed, stopped } = this.state as FrameState;
    if (allowed === null) {
      return <Box color="label">Проверка режима страниц…</Box>;
    }
    if (allowed === false || stopped) {
      return (
        <Stack vertical fill>
          <Stack.Item>
            <NoticeBox>
              {stopped
                ? 'Страница подвесила клиент и была остановлена.'
                : 'Этот клиент не умеет показывать страницы целиком.'}
            </NoticeBox>
          </Stack.Item>
          <Stack.Item grow>{fallback}</Stack.Item>
        </Stack>
      );
    }
    return (
      <Stack vertical fill>
        <Stack.Item>
          <Button icon="stop" onClick={() => this.setState({ stopped: true })}>
            Остановить страницу
          </Button>
        </Stack.Item>
        <Stack.Item grow>
          <iframe
            key={url}
            title={title}
            ref={(node: any) => {
              if (!node || node.dataset.scpnetLoaded === url) {
                return;
              }
              node.dataset.scpnetLoaded = url;
              node.setAttribute('sandbox', FRAME_SANDBOX);
              node.setAttribute('csp', FRAME_POLICY);
              node.setAttribute('referrerpolicy', 'no-referrer');
              node.setAttribute('allow', '');
              node.setAttribute('src', url);
            }}
            style={{
              width: '100%',
              height: '100%',
              border: 'none',
              background: '#ffffff',
            }}
          />
        </Stack.Item>
      </Stack>
    );
  }
}

const PageText = (props) => {
  const { text } = props;
  if (!text) {
    return <Box color="label">Страница пуста.</Box>;
  }
  return <Box preserveWhitespace>{text}</Box>;
};

const LoginPanel = (props, context) => {
  const { act, data } = useBackend<Data>(context);
  const { login } = data;
  return (
    <Section title="Свои сайты">
      {(login.code && (
        <Box>
          <Box bold fontSize="1.4rem">
            {login.code}
          </Box>
          <Box color="label">
            Введите код в редакторе. Никому его не передавайте.
          </Box>
        </Box>
      )) || (
        <Stack align="center">
          <Stack.Item>
            <Button
              icon="key"
              disabled={login.pending || login.retry_seconds > 0}
              onClick={() => act('login')}
            >
              {login.pending ? 'Запрос…' : 'Получить код для редактора'}
            </Button>
          </Stack.Item>
          {login.retry_seconds > 0 && (
            <Stack.Item color="label">
              Ещё раз через {login.retry_seconds} с
            </Stack.Item>
          )}
        </Stack>
      )}
      {login.error && <Box color="bad">{login.error}</Box>}
    </Section>
  );
};

const SearchResults = (props, context) => {
  const { act, data } = useBackend<Data>(context);
  const { search } = data;
  return (
    <Section title={'Найдено по запросу «' + search.query + '»'}>
      {(search.results.length &&
        search.results.map((entry) => (
          <Box key={entry.site_id + '/' + entry.slug} mb={1}>
            <Button
              fluid
              onClick={() =>
                act('open', { site_id: entry.site_id, slug: entry.slug })
              }
            >
              {entry.title}
            </Button>
            <Box color="label">{entry.snippet}</Box>
          </Box>
        ))) || <Box color="label">Ничего не нашлось.</Box>}
    </Section>
  );
};

const SiteList = (props, context) => {
  const { act, data } = useBackend<Data>(context);
  const { catalog } = data;
  if (!catalog.length) {
    return (
      <Section title="Сайты">
        <Box color="label">Каталог пуст.</Box>
      </Section>
    );
  }
  return (
    <Section title="Сайты">
      {catalog.map((site) => (
        <Section key={site.id} title={site.title}>
          <Box color="label" mb={1}>
            {site.domain}
          </Box>
          {site.pages.map((page) => (
            <Button
              key={page.slug}
              mr={1}
              onClick={() => act('open', { site_id: site.id, slug: page.slug })}
            >
              {page.title}
            </Button>
          ))}
        </Section>
      ))}
    </Section>
  );
};

export const NtosSCPnet = (props, context) => {
  const { act, data } = useBackend<Data>(context);
  const { available, loading, site, page, slug, search } = data;
  const [query, setQuery] = useLocalState(context, 'scpnet_query', '');
  const address = site ? site.domain + (slug === 'index' ? '' : '/' + slug) : '';
  const frame = page && FRAME_ADDRESS.test(page.frame || '') ? page.frame : null;
  return (
    <NtosWindow width={900} height={700} resizable>
      <NtosWindow.Content>
        <Stack vertical fill>
          <Stack.Item>
            <Section>
              <Stack align="center">
                <Stack.Item>
                  <Button
                    icon="home"
                    disabled={!site && !search.query}
                    onClick={() => act('home')}
                  />
                </Stack.Item>
                <Stack.Item>
                  <Button icon="sync" onClick={() => act('refresh')} />
                </Stack.Item>
                <Stack.Item grow>
                  {(site && <Box>{address}</Box>) || (
                    <Input
                      fluid
                      value={query}
                      placeholder="Поиск по SCPnet"
                      onInput={(event, value) => setQuery(value)}
                      onEnter={(event, value) => act('search', { query: value })}
                    />
                  )}
                </Stack.Item>
                {!site && (
                  <Stack.Item>
                    <Button
                      icon="search"
                      disabled={search.pending}
                      onClick={() => act('search', { query: query })}
                    >
                      Найти
                    </Button>
                  </Stack.Item>
                )}
              </Stack>
            </Section>
          </Stack.Item>
          {!available && (
            <Stack.Item>
              <NoticeBox>SCPnet недоступен. Показано сохранённое.</NoticeBox>
            </Stack.Item>
          )}
          {search.error && !site && (
            <Stack.Item>
              <NoticeBox>{search.error}</NoticeBox>
            </Stack.Item>
          )}
          <Stack.Item grow>
            {(loading && (
              <Section fill>
                <Box color="label">
                  <Icon name="spinner" spin mr={1} />
                  Загрузка…
                </Box>
              </Section>
            )) ||
              (site && (
                <Section fill scrollable={!frame} title={page && page.title}>
                  {(page &&
                    ((frame && (
                      <PageFrame
                        key={frame}
                        url={frame}
                        title={page.title}
                        fallback={<PageText text={page.text} />}
                      />
                    )) || <PageText text={page.text} />)) || (
                    <Box color="label">Страница не открылась.</Box>
                  )}
                </Section>
              )) ||
              (search.query && <SearchResults />) || <SiteList />}
          </Stack.Item>
          {!site && (
            <Stack.Item>
              <LoginPanel />
            </Stack.Item>
          )}
        </Stack>
      </NtosWindow.Content>
    </NtosWindow>
  );
};
