"use strict";

//  ---------------------------------------------------------------------------

const Exchange = require ('./base/Exchange')
const { ExchangeError, InsufficientFunds, OrderNotFound, DDoSProtection } = require ('./base/errors')

//  ---------------------------------------------------------------------------

module.exports = class zaif extends Exchange {

    describe () {
        return this.deepExtend (super.describe (), {
            'id': 'zaif',
            'name': 'Zaif',
            'countries': 'JP',
            'rateLimit': 2000,
            'version': '1',
            'hasCORS': false,
            'hasFetchOpenOrders': true,
            'hasFetchClosedOrders': true,
            'hasWithdraw': true,
            'urls': {
                'logo': 'https://user-images.githubusercontent.com/1294454/27766927-39ca2ada-5eeb-11e7-972f-1b4199518ca6.jpg',
                'api': 'https://api.zaif.jp',
                'www': 'https://zaif.jp',
                'doc': [
                    'http://techbureau-api-document.readthedocs.io/ja/latest/index.html',
                    'https://corp.zaif.jp/api-docs',
                    'https://corp.zaif.jp/api-docs/api_links',
                    'https://www.npmjs.com/package/zaif.jp',
                    'https://github.com/you21979/node-zaif',
                ],
            },
            'api': {
                'public': {
                    'get': [
                        'depth/{pair}',
                        'currencies/{pair}',
                        'currencies/all',
                        'currency_pairs/{pair}',
                        'currency_pairs/all',
                        'last_price/{pair}',
                        'ticker/{pair}',
                        'trades/{pair}',
                    ],
                },
                'private': {
                    'post': [
                        'active_orders',
                        'cancel_order',
                        'deposit_history',
                        'get_id_info',
                        'get_info',
                        'get_info2',
                        'get_personal_info',
                        'trade',
                        'trade_history',
                        'withdraw',
                        'withdraw_history',
                    ],
                },
                'ecapi': {
                    'post': [
                        'createInvoice',
                        'getInvoice',
                        'getInvoiceIdsByOrderNumber',
                        'cancelInvoice',
                    ],
                },
            },
        }
    }

    async fetchMarkets () {
        let markets = await this.publicGetCurrencyPairsAll ();
        let result = [];
        for (let p = 0; p < markets.length; p++) {
            let market = markets[p];
            let id = market['currency_pair'];
            let symbol = market['name'];
            let [ base, quote ] = symbol.split ('/');
            result.push ({
                'id': id,
                'symbol': symbol,
                'base': base,
                'quote': quote,
                'info': market,
            });
        }
        return result;
    }

    async fetchBalance (params = {}) {
        await this.loadMarkets ();
        let response = await this.privatePostGetInfo ();
        let balances = response['return'];
        let result = { 'info': balances };
        let currencies = Object.keys (balances['funds']);
        for (let c = 0; c < currencies.length; c++) {
            let currency = currencies[c];
            let balance = balances['funds'][currency];
            let uppercase = currency.toUpperCase ();
            let account = {
                'free': balance,
                'used': 0.0,
                'total': balance,
            };
            if ('deposit' in balances) {
                if (currency in balances['deposit']) {
                    account['total'] = balances['deposit'][currency];
                    account['used'] = account['total'] - account['free'];
                }
            }
            result[uppercase] = account;
        }
        return this.parseBalance (result);
    }

    async fetchOrderBook (symbol, params = {}) {
        await this.loadMarkets ();
        let orderbook = await this.publicGetDepthPair (this.extend ({
            'pair': this.marketId (symbol),
        }, params));
        return this.parseOrderBook (orderbook);
    }

    async fetchTicker (symbol, params = {}) {
        await this.loadMarkets ();
        let ticker = await this.publicGetTickerPair (this.extend ({
            'pair': this.marketId (symbol),
        }, params));
        let timestamp = this.milliseconds ();
        return {
            'symbol': symbol,
            'timestamp': timestamp,
            'datetime': this.iso8601 (timestamp),
            'high': ticker['high'],
            'low': ticker['low'],
            'bid': ticker['bid'],
            'ask': ticker['ask'],
            'vwap': ticker['vwap'],
            'open': undefined,
            'close': undefined,
            'first': undefined,
            'last': ticker['last'],
            'change': undefined,
            'percentage': undefined,
            'average': undefined,
            'baseVolume': undefined,
            'quoteVolume': ticker['volume'],
            'info': ticker,
        };
    }

    parseTrade (trade, market = undefined) {
        let side = (trade['trade_type'] == 'bid') ? 'buy' : 'sell';
        let timestamp = trade['date'] * 1000;
        let id = this.safeString (trade, 'id');
        id = this.safeString (trade, 'tid', id);
        if (!market)
            market = this.markets_by_id[trade['currency_pair']];
        return {
            'id': id.toString (),
            'info': trade,
            'timestamp': timestamp,
            'datetime': this.iso8601 (timestamp),
            'symbol': market['symbol'],
            'type': undefined,
            'side': side,
            'price': trade['price'],
            'amount': trade['amount'],
        };
    }

    async fetchTrades (symbol, params = {}) {
        await this.loadMarkets ();
        let market = this.market (symbol);
        let response = await this.publicGetTradesPair (this.extend ({
            'pair': market['id'],
        }, params));
        return this.parseTrades (response, market);
    }

    async createOrder (symbol, type, side, amount, price = undefined, params = {}) {
        await this.loadMarkets ();
        if (type == 'market')
            throw new ExchangeError (this.id + ' allows limit orders only');
        let response = await this.privatePostTrade (this.extend ({
            'currency_pair': this.marketId (symbol),
            'action': (side == 'buy') ? 'bid' : 'ask',
            'amount': amount,
            'price': price,
        }, params));
        return {
            'info': response,
            'id': response['return']['order_id'].toString (),
        };
    }

    async cancelOrder (id, symbol = undefined, params = {}) {
        return await this.privatePostCancelOrder (this.extend ({
            'order_id': id,
        }, params));
    }

    parseOrder (order, market = undefined) {
        let side = (order['action'] == 'bid') ? 'buy' : 'sell';
        let timestamp = parseInt (order['timestamp']) * 1000;
        if (!market)
            market = this.markets_by_id[order['currency_pair']];
        let price = order['price'];
        let amount = order['amount'];
        return {
            'id': order['id'].toString (),
            'timestamp': timestamp,
            'datetime': this.iso8601 (timestamp),
            'status': 'open',
            'symbol': market['symbol'],
            'type': 'limit',
            'side': side,
            'price': price,
            'cost': price * amount,
            'amount': amount,
            'filled': undefined,
            'remaining': undefined,
            'trades': undefined,
            'fee': undefined,
        };
    }

    parseOrders (orders, market = undefined) {
        let ids = Object.keys (orders);
        let result = [];
        for (let i = 0; i < ids.length; i++) {
            let id = ids[i];
            let order = orders[id];
            let extended = this.extend (order, { 'id': id });
            result.push (this.parseOrder (extended, market));
        }
        return result;
    }

    async fetchOpenOrders (symbol = undefined, params = {}) {
        await this.loadMarkets ();
        let market = undefined;
        let request = {
            // 'is_token': false,
            // 'is_token_both': false,
        };
        if (symbol) {
            market = this.market (symbol);
            request['currency_pair'] = market['id'];
        }
        let response = await this.privatePostActiveOrders (this.extend (request, params));
        return this.parseOrders (response['return'], market);
    }

    async fetchClosedOrders (symbol = undefined, params = {}) {
        await this.loadMarkets ();
        let market = undefined;
        let request = {
            // 'from': 0,
            // 'count': 1000,
            // 'from_id': 0,
            // 'end_id': 1000,
            // 'order': 'DESC',
            // 'since': 1503821051,
            // 'end': 1503821051,
            // 'is_token': false,
        };
        if (symbol) {
            market = this.market (symbol);
            request['currency_pair'] = market['id'];
        }
        let response = await this.privatePostTradeHistory (this.extend (request, params));
        return this.parseOrders (response['return'], market);
    }

    async withdraw (currency, amount, address, params = {}) {
        await this.loadMarkets ();
        if (currency == 'JPY')
            throw new ExchangeError (this.id + ' does not allow ' + currency + ' withdrawals');
        let result = await this.privatePostWithdraw (this.extend ({
            'currency': currency,
            'amount': amount,
            'address': address,
            // 'message': 'Hi!', // XEM only
            // 'opt_fee': 0.003, // BTC and MONA only
        }, params));
        return {
            'info': result,
            'id': result['return']['txid'],
            'fee': result['return']['fee'],
        };
    }

    sign (path, api = 'public', method = 'GET', params = {}, headers = undefined, body = undefined) {
        let url = this.urls['api'] + '/';
        if (api == 'public') {
            url += 'api/' + this.version + '/' + this.implodeParams (path, params);
        } else {
            url += (api == 'ecapi') ? 'ecapi' : 'tapi';
            let nonce = this.nonce ();
            body = this.urlencode (this.extend ({
                'method': path,
                'nonce': nonce,
            }, params));
            headers = {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Key': this.apiKey,
                'Sign': this.hmac (this.encode (body), this.encode (this.secret), 'sha512'),
            };
        }
        return { 'url': url, 'method': method, 'body': body, 'headers': headers };
    }

    async request (path, api = 'api', method = 'GET', params = {}, headers = undefined, body = undefined) {
        let response = await this.fetch2 (path, api, method, params, headers, body);
        if ('error' in response)
            throw new ExchangeError (this.id + ' ' + response['error']);
        if ('success' in response)
            if (!response['success'])
                throw new ExchangeError (this.id + ' ' + this.json (response));
        return response;
    }
}