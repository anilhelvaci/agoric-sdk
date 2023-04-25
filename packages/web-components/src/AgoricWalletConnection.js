/* eslint-disable no-underscore-dangle */
// @ts-check
import { html, css, LitElement } from 'lit';

import { assert, details as X } from '@agoric/assert';
import { makeCache } from '@agoric/cache';
// eslint-disable-next-line @typescript-eslint/prefer-ts-expect-error
// @ts-ignore
import { makeCapTP as defaultMakeCapTP } from '@endo/captp';
import { E } from '@endo/eventual-send';
import { Far } from '@endo/marshal';
import { makePromiseKit } from '@endo/promise-kit';

import 'robot3/debug';
import { interpret } from 'robot3';

import { makeConnectionMachine } from './states.js';

import { makeAdminWebSocketConnector } from './admin-websocket-connector.js';
import { makeBridgeIframeConnector } from './bridge-iframe-connector.js';

// Delay after a reset.
const RESET_DELAY_MS = 3000;

const DEFAULT_LOCATOR_URL =
  'https://wallet.agoric.app/locator/?append=/wallet/bridge.html';

const LOCAL_STORAGE_LOCATOR_URL =
  'https://wallet.agoric.app/locator/?append=/wallet/bridge.html';

const DEFAULT_WALLET_UI_HREF = 'https://wallet.agoric.app/wallet/';

const delay = (ms, resolution) =>
  new Promise(resolve => setTimeout(resolve, ms, resolution));

export const makeAgoricWalletConnection = (makeCapTP = defaultMakeCapTP) =>
  class AgoricWalletConnection extends LitElement {
    static get styles() {
      return css`
        :host {
          display: block;
          padding: 8px;
          color: var(--agoric-wallet-connection-text-color, #737373);
        }
        .connection {
          background-color: #fff;
        }
        .connection-message {
          text-align: center;
        }
        .connection-message > a {
          text-decoration: none;
          color: #1976d2;
        }
      `;
    }

    static get properties() {
      return {
        state: { type: String },
        useLocalStorage: { type: Boolean },
      };
    }

    get state() {
      return this.machine.state.name;
    }

    async reset() {
      if (this.isResetting) {
        return;
      }
      this.isResetting = true;
      await delay(RESET_DELAY_MS, 'reset');
      if (this._captp) {
        this._captp.abort();
        this._captp = null;
      }
      if (this._connector) {
        this._connector.hostDisconnected();
        this._connector = null;
      }

      // Just make sure the reconnection logic is triggered.
      this._bridgePK = makePromiseKit();
      this._cache = undefined;
      this._makeDefaultLeader = undefined;

      this.service.send({ type: 'reset' });
      this.isResetting = false;
    }

    get cache() {
      if (this._cache) {
        // The cache is cached.
        return this._cache;
      }
      const cache = makeCache(E(this._bridgePK.promise).getCacheCoordinator());
      this._cache = cache;
      return this._cache;
    }

    get walletConnection() {
      if (this._walletConnection) {
        // Cached.
        return this._walletConnection;
      }

      this._walletConnection = Far('WalletConnection', {
        getScopedBridge: (
          suggestedDappPetname,
          dappOrigin = window.location.origin,
          makeConnector = makeBridgeIframeConnector,
        ) => {
          assert.equal(
            this.state,
            'idle',
            X`Cannot get scoped bridge in state ${this.state}`,
          );
          this.service.send({
            type: 'locate',
            connectionParams: {
              caller: 'getScopedBridge',
              suggestedDappPetname,
              dappOrigin,
              makeConnector,
            },
          });
          return this._bridgePK.promise;
        },
        getAdminBootstrap: (
          accessToken,
          makeConnector = makeAdminWebSocketConnector,
        ) => {
          assert.equal(
            this.state,
            'idle',
            X`Cannot get admin bootstrap in state ${this.state}`,
          );
          this.service.send({
            type: 'locate',
            connectionParams: {
              caller: 'getAdminBootstrap',
              accessToken,
              makeConnector,
            },
          });
          return this._bridgePK.promise;
        },
        reset: () => {
          void this.reset();
        },
      });

      return this._walletConnection;
    }

    constructor() {
      super();
      this.useLocalStorage = false;
      // This state machine integration is much like lit-robot, but also raises
      // state events.
      const machine = makeConnectionMachine();
      const onState = (service, requestUpdate = true) => {
        this.machine = service.machine;
        const ev = new CustomEvent('state', {
          detail: {
            ...this.machine.context,
            state: this.machine.state.name,
            walletConnection: this.walletConnection,
            cache: this.cache,
          },
        });
        this.dispatchEvent(ev);
        if (requestUpdate) {
          this.requestUpdate();
        }
      };
      this.service = interpret(machine, onState);
      this.machine = this.service.machine;

      // Wait until we load before sending the first state.
      this.firstUpdated = () => onState(this.service, false);

      this._nextEpoch = 0;
      this._bridgePK = makePromiseKit();

      this._walletCallbacks = Far('walletCallbacks', {
        needDappApproval: (dappOrigin, suggestedDappPetname) => {
          this.service.send({
            type: 'needDappApproval',
            dappOrigin,
            suggestedDappPetname,
          });
        },
        dappApproved: dappOrigin => {
          this.service.send({ type: 'dappApproved', dappOrigin });
        },
      });
    }

    onLocateMessage(ev) {
      console.log(this.state, 'locate', ev);
      const { data } = ev.detail;
      assert.typeof(data, 'string', X`Expected locate message to be a string`);
      this.service.send({ type: 'located', href: data });
    }

    onError(event) {
      console.log(this.state, 'error', event);
      this.service.send({
        type: 'error',
        error: (event.detail && event.detail.error) || 'Unknown error',
      });

      // Allow retries to get a fresh bridge.
      this._captp = null;
    }

    _startCapTP(send, ourEndpoint, ourPublishedBootstrap) {
      // Start a new epoch of the bridge captp.
      const epoch = this._nextEpoch;
      this._nextEpoch += 1;

      this._captp = makeCapTP(
        `${ourEndpoint}.${epoch}`,
        obj => {
          // console.log('sending', obj);
          send(obj);
        },
        ourPublishedBootstrap,
        { epoch },
      );
    }

    disconnectedCallback() {
      super.disconnectedCallback();
      if (this._captp) {
        this._captp.abort();
        this._captp = null;
      }
      if (this._connector) {
        this._connector.hostDisconnected();
        this._connector = null;
      }
    }

    render() {
      /** @type {import('lit-html').TemplateResult<1> | undefined} */
      let backend;
      const locatorHref = this.useLocalStorage
        ? LOCAL_STORAGE_LOCATOR_URL
        : DEFAULT_LOCATOR_URL;

      switch (this.state) {
        case 'locating': {
          backend = html`
            <agoric-iframe-messenger
              src=${locatorHref}
              @message=${this.onLocateMessage}
              @error=${this.onError}
            ></agoric-iframe-messenger>
          `;
          break;
        }
        case 'approving':
        case 'bridged':
        case 'connecting': {
          if (!this._connector) {
            this._connector =
              this.service.context.connectionParams.makeConnector(this);
            this._connector.hostConnected();
          }
          backend = this._connector.render();
          break;
        }
        default:
      }

      // Link to the default wallet ui for regular users.
      const walletUiUrl = new URL(DEFAULT_WALLET_UI_HREF);

      return html` <div class="connection">
        ${backend}
        <div class="connection-message">
          Open wallet:
          <a href=${walletUiUrl} target="_blank"
            >${walletUiUrl.host}${walletUiUrl.pathname}</a
          >
        </div>
      </div>`;
    }
  };

export const AgoricWalletConnection = makeAgoricWalletConnection();
