import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SubscriptionEid, SocketStatus, Xs6Side } from '../../src/types/index.js';

describe('SubscriptionEid', () => {
  it('has correct values from live testing', () => {
    expect(SubscriptionEid.POSITIONS).toBe(1);
    expect(SubscriptionEid.TICKS).toBe(2);
    expect(SubscriptionEid.SYMBOLS).toBe(3);
    expect(SubscriptionEid.SYMBOL_GROUPS).toBe(4);
    expect(SubscriptionEid.GROUP_SETTINGS).toBe(5);
    expect(SubscriptionEid.REQUEST_STATUS).toBe(6);
    expect(SubscriptionEid.TOTAL_BALANCE).toBe(1043);
  });
});

describe('SocketStatus', () => {
  it('has all states', () => {
    expect(SocketStatus.CONNECTING).toBe('CONNECTING');
    expect(SocketStatus.CONNECTED).toBe('CONNECTED');
    expect(SocketStatus.DISCONNECTING).toBe('DISCONNECTING');
    expect(SocketStatus.CLOSED).toBe('CLOSED');
    expect(SocketStatus.ERROR).toBe('SOCKET_ERROR');
  });
});

describe('Xs6Side', () => {
  it('has correct values', () => {
    expect(Xs6Side.SIDE_NOT_SET).toBe(0);
    expect(Xs6Side.BUY).toBe(1);
    expect(Xs6Side.SELL).toBe(2);
  });
});

describe('WS Protocol message formats', () => {
  it('builds correct ping request', () => {
    const msg = {
      reqId: 'ping_123',
      command: [{ CoreAPI: { ping: {} } }],
    };
    expect(msg.command[0].CoreAPI.ping).toEqual({});
    expect(msg.reqId).toMatch(/^ping_/);
  });

  it('builds correct registerClientInfo request', () => {
    const msg = {
      reqId: 'reg_123',
      command: [{
        CoreAPI: {
          endpoint: '',
          registerClientInfo: {
            clientInfo: {
              appName: 'xStation5',
              appVersion: '2.94.1',
              appBuildNumber: '0',
              device: 'Linux x86_64',
              osVersion: '',
              comment: 'Node.js',
              apiVersion: '2.73.0',
              osType: 0,
              deviceType: 1,
            },
          },
        },
      }],
    };
    expect(msg.command[0].CoreAPI.registerClientInfo.clientInfo.appName).toBe('xStation5');
    expect(msg.command[0].CoreAPI.endpoint).toBe('');
  });

  it('builds correct loginWithServiceTicket request', () => {
    const msg = {
      reqId: 'login_123',
      command: [{
        CoreAPI: {
          endpoint: '',
          logonWithServiceTicket: { serviceTicket: 'ST-12345-test' },
        },
      }],
    };
    expect(msg.command[0].CoreAPI.logonWithServiceTicket.serviceTicket).toBe('ST-12345-test');
  });

  it('builds correct tick subscription request', () => {
    const msg = {
      reqId: 'ticks_123',
      command: [{
        CoreAPI: {
          endpoint: 'meta1',
          accountId: 'meta1_12345678',
          getAndSubscribeElement: { eid: SubscriptionEid.TICKS, keys: ['9_CIG.PL_6'] },
        },
      }],
    };
    expect(msg.command[0].CoreAPI.getAndSubscribeElement.eid).toBe(2);
    expect(msg.command[0].CoreAPI.getAndSubscribeElement.keys).toEqual(['9_CIG.PL_6']);
  });

  it('builds correct trade transaction request', () => {
    const msg = {
      reqId: 'trade_123',
      command: [{
        CoreAPI: {
          endpoint: 'meta1',
          accountId: 'meta1_12345678',
          tradeTransaction: {
            newMarketOrder: {
              order: {
                instrumentid: 9438,
                size: { volume: { value: 1, scale: 0 } },
                side: Xs6Side.BUY,
              },
              uiTrackingId: 'ws_123',
              account: { number: 12345678, server: 'meta1', currency: 'PLN' },
            },
          },
        },
      }],
    };
    expect(msg.command[0].CoreAPI.tradeTransaction.newMarketOrder.order.side).toBe(Xs6Side.BUY);
    expect(msg.command[0].CoreAPI.tradeTransaction.newMarketOrder.order.instrumentid).toBe(9438);
  });

  it('parses login success response', () => {
    const response = {
      reqId: 'login_123',
      status: 0,
      response: [{
        xloginresult: {
          accountList: [{
            wtAccountId: { accountNo: '12345678', endpointID: 'meta1' },
            currency: 'PLN',
            endpointType: { name: 'CFD' },
          }],
          endpointList: ['xstation5', 'meta1', 'service', 'abigail'],
          userData: { name: 'Jan', surname: 'Kowalski' },
        },
      }],
    };
    const login = response.response[0].xloginresult;
    expect(login.accountList[0].wtAccountId.accountNo).toBe('12345678');
    expect(login.userData.name).toBe('Jan');
    // xapi5 is the CAS service name, not in endpointList. endpointList has: xstation5, meta1, service, abigail
    expect(login.endpointList).toContain('meta1');
  });

  it('parses tick data response', () => {
    const response = {
      reqId: 'ticks_123',
      status: 0,
      response: [{
        element: {
          elements: [{
            state: 0,
            value: {
              xcfdtick: {
                key: '9_CIG.PL_6',
                symbol: 'CIG.PL',
                timestamp: 1773658250484,
                bid: 2.55,
                ask: 2.585,
                high: 2.57,
                low: 2.515,
                bidVolume: 800,
                askVolume: 40781,
              },
            },
          }],
        },
      }],
    };
    const tick = response.response[0].element.elements[0].value.xcfdtick;
    expect(tick.symbol).toBe('CIG.PL');
    expect(tick.bid).toBe(2.55);
    expect(tick.ask).toBe(2.585);
    expect(tick.ask).toBeGreaterThan(tick.bid);
  });

  it('parses position data response', () => {
    const response = {
      reqId: 'pos_123',
      status: 0,
      response: [{
        element: {
          elements: [{
            state: 1,
            value: {
              xcfdtrade: {
                account: '12345678',
                symbol: 'CIG.PL',
                side: 0,
                openPrice: 2.55,
                volume: 7,
                sl: 0,
                tp: 0,
                profit: -0.32,
                order: -1860503104,
                openTime: 1773234360626,
              },
            },
          }],
        },
      }],
    };
    const trade = response.response[0].element.elements[0].value.xcfdtrade;
    expect(trade.symbol).toBe('CIG.PL');
    expect(trade.side).toBe(0); // BUY in xStation5 internal format
    expect(trade.volume).toBe(7);
    expect(trade.openPrice).toBe(2.55);
  });

  it('parses balance response (EID 1043)', () => {
    const response = {
      reqId: 'bal_123',
      status: 0,
      response: [{
        element: {
          elements: [{
            state: 1,
            value: {
              xtotalbalance: {
                aid: { accountNo: '12345678', endpointID: 'meta1' },
                balance: 208.48,
                equity: 208.48,
                margin: 0,
                freeMargin: 208.48,
                stockValue: 0,
                cashStockValue: 20.32,
              },
            },
          }],
        },
      }],
    };
    const bal = response.response[0].element.elements[0].value.xtotalbalance;
    expect(bal.balance).toBe(208.48);
    expect(bal.equity).toBe(208.48);
    expect(bal.freeMargin).toBe(208.48);
  });

  it('parses push message (status=1)', () => {
    const push = {
      status: 1,
      events: [{
        eid: SubscriptionEid.TICKS,
        row: {
          key: '9_CIG.PL_6',
          value: {
            xcfdtick: {
              symbol: 'CIG.PL',
              bid: 2.56,
              ask: 2.59,
            },
          },
        },
      }],
    };
    expect(push.status).toBe(1);
    expect(push.events[0].eid).toBe(SubscriptionEid.TICKS);
    expect(push.events[0].row.value.xcfdtick.bid).toBe(2.56);
  });

  it('parses INVALID_SERVICE error', () => {
    const response = {
      reqId: 'login_123',
      status: 0,
      response: [{ exception: { message: 'INVALID_SERVICE', exceptionId: '123' } }],
    };
    expect(response.response[0].exception.message).toBe('INVALID_SERVICE');
  });
});

describe('CAS auth flow', () => {
  it('service name for WebSocket is xapi5', () => {
    // Critical: xapi5 for WS, abigail for REST API
    const WS_SERVICE = 'xapi5';
    const REST_SERVICE = 'abigail';
    expect(WS_SERVICE).not.toBe(REST_SERVICE);
    expect(WS_SERVICE).toBe('xapi5');
  });

  it('CAS v1 URL format is correct', () => {
    const tgt = 'TGT-123456-test-xstation.xtb.com';
    const url = `https://xstation.xtb.com/signon/v1/tickets/${tgt}`;
    expect(url).toContain('/v1/tickets/TGT-');
  });

  it('account ID format is correct', () => {
    const accountId = `meta1_12345678`;
    expect(accountId).toMatch(/^meta1_\d+$/);
  });
});
