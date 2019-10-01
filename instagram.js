/**
  * @author Alex Yatsenko
  * @link https://github.com/yatsenkolesh/instagram-nodejs
*/

"use-strict";

const fetch = require('node-fetch');
const formData = require('form-data');

module.exports = class Instagram {
  /**
    * Constructor
  */
  constructor(csrfToken, sessionId) {
    this.csrfToken = csrfToken
    this.sessionId = sessionId
    this.userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_13_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/68.0.3440.106 Safari/537.36'
    this.userIdFollowers = {};
    this.timeoutForCounter = 300
    this.timeoutForCounterValue = 30000
    this.paginationDelay = 30000
    this.receivePromises = {}
    this.searchTypes = ['location', 'hashtag']
    this.twoFactorRequired = false;
    this.lastFourDigit = undefined;
    this.twoFactorIdentifier = undefined;
    this.username = undefined;

    this.essentialValues = {
      sessionid: undefined,
      ds_user_id: undefined,
      csrftoken: undefined,
      shbid: undefined,
      rur: undefined,
      mid: undefined,
      shbts: undefined,
      mcd: undefined,
      ig_cb: 1,
      //urlgen      : undefined //this needs to be filled in according to my RE
    };

    this.baseHeader = {
      'accept-langauge': 'en-US;q=0.9,en;q=0.8,es;q=0.7',
      'origin': 'https://www.instagram.com',
      'referer': 'https://www.instagram.com/',
      'upgrade-insecure-requests': '1',
      'user-agent': this.userAgent,
    }
  }


  generateCookie(simple) {
    if (simple) return 'ig_cb=1'

    var cookie = ''
    var keys = Object.keys(this.essentialValues)
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      if (this.essentialValues[key] !== undefined) {
        cookie += key + '=' + this.essentialValues[key] + (i < keys.length - 1 ? '; ' : '')
      }
    }

    return cookie;
  }

  combineWithBaseHeader(data) {
    return Object.assign(this.baseHeader, data)
  }

  updateEssentialValues(src, isHTML) {
    //assumes that essential values will be extracted from a cookie unless specified by the isHTML bool

    if (!isHTML) {
      var keys = Object.keys(this.essentialValues)

      for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        if (!this.essentialValues[key])
          for (let cookie in src)
            if (src[cookie].includes(key) && !src[cookie].includes(key + '=""')) {
              var cookieValue = src[cookie].split(';')[0].replace(key + '=', '')
              this.essentialValues[key] = cookieValue
              break;
            }
      }
    } else {
      var subStr = src;

      var startStr = '<script type="text/javascript">window._sharedData = ';
      var start = subStr.indexOf(startStr) + startStr.length;
      subStr = subStr.substr(start, subStr.length);

      subStr = subStr.substr(0, subStr.indexOf('</script>') - 1);

      var json = JSON.parse(subStr);

      this.essentialValues.csrftoken = json.config.csrf_token;
      this.rollout_hash = json.rollout_hash;
    }
  }


 getMyProfile(userId){
    const gqlVars = {
      userId: userId,
      include_reel: true
    };
    return fetch('https://www.instagram.com/graphql/query/?query_hash=aec5501414615eca36a9acf075655b1e&variables=' + encodeURIComponent(JSON.stringify(gqlVars)),
      {
        headers: this.combineWithBaseHeader(
          {
            'accept': '*/*',
            'accept-encoding': 'gzip, deflate, br',
            'cookie': this.generateCookie()
          }
        )
      }).then(t =>
        // console.log(t)
        t.json().then(r => r)
      );
 }

  /**
    * User data by username
    * @param {String} username
    * @return {Object} Promise
  */
  getUserDataByUsername(username) {

    var fetch_data = {
      'method': 'get',
      'headers':
        this.combineWithBaseHeader(
          {
            'accept': 'text/html,application/xhtml+xml,application/xml;q0.9,image/webp,image/apng,*.*;q=0.8',
            'accept-encoding': 'gzip, deflate, br',
            'cookie': this.generateCookie(),
            'referer' : 'https://www.instagram.com/' + username
          }
        )
    }

    return fetch('https://www.instagram.com/' + username + "/?__a=1", fetch_data)
            .then(t =>
                // console.log(t)
                t.json().then(r => r)
            );
  }

  /**
    Is private check
    * @param {String} usernmae
  */
  isPrivate(username) {
    return this.getUserDataByUsername(username).then((data) =>
      data.user.is_private
    )
  }

  /**
    * User followers list
    * Bench - 1k followers/1 min
    * @param {Int} userId
    * @param {String} endCursor cursor used to fetch next page
    * @param {Int} count count of results to return (API may return less)
    * @param {Int} followersCounter counter of followers
    * @param {Boolean} selfSelf if call by self
    * @return {Object} array followers list
  */
  getUserFollowers(userId, endCursor, count) {
    const self = this;
    count = count || 24;
    const query = {
      id: userId,
      first: count
    };
    if (endCursor) {
      query.after = endCursor;
    }
    const variables = encodeURIComponent(JSON.stringify(query));

    return fetch('https://www.instagram.com/graphql/query/?query_hash=56066f031e6239f35a904ac20c9f37d9&variables=' + variables,
      {
        'method': 'get',
        'headers':
          this.combineWithBaseHeader(
            {
              'accept': 'text/html,application/xhtml+xml,application/xml;q0.9,image/webp,image/apng,*.*;q=0.8',
              'accept-encoding': 'gzip, deflate, br',
              'cookie': this.generateCookie()
            }
          )
      }).then(res => {
        return res.text().then((response) => {
          //prepare convert to json
          let json = response;

          try {
            json = JSON.parse(response)
          }
          catch (e) {
            console.log('Session error')
            console.log(response)
            return [];
          }
          return json;
        }).catch((e) => {
          console.log('Instagram returned:' + e)
        })
      })
  }

  getPostsFromHashtag(tagName, endCursor, count){
    const self = this;
    count = count || 12;

    const query = {
      tag_name: tagName,
      first: count,
      locations: "show"
    };
    if (endCursor) {
      query.after = endCursor;
    }

    const variables = encodeURIComponent(JSON.stringify(query));
    return fetch('https://www.instagram.com/graphql/query/?query_hash=174a5243287c5f3a7de741089750ab3b&variables=' + variables,
      {
        'method': 'get',
        'headers':
          this.combineWithBaseHeader(
            {
              'accept': 'text/html,application/xhtml+xml,application/xml;q0.9,image/webp,image/apng,*.*;q=0.8',
              'accept-encoding': 'gzip, deflate, br',
              'cookie': this.generateCookie()
            }
          )
      }).then(res => {
        return res.text().then((response) => {
          //prepare convert to json
          let json = response;

          try {
            json = JSON.parse(response)
          }
          catch (e) {
            console.log('Session error')
            console.log(response)
            return [];
          }
          return json;
        }).catch((e) => {
          console.log('Instagram returned:' + e)
        })
      })
  }

  /**
    * Get csrf token
    * @return {Object} Promise
  */
  getCsrfToken() {
    return fetch('https://www.instagram.com',
      {
        'method': 'get',
        'headers':
          this.combineWithBaseHeader(
            {
              'accept': 'text/html,application/xhtml+xml,application/xml;q0.9,image/webp,image/apng,*.*;q=0.8',
              'accept-encoding': 'gzip, deflate, br',
              'cookie': this.generateCookie(true)
            }
          )
      }).then(t => {
        this.updateEssentialValues(t.headers._headers['set-cookie'])
        return t.text()
      }).then(html => {
        this.updateEssentialValues(html, true)
        return this.essentialValues.csrftoken
      }).catch(() =>
        console.log('Failed to get instagram csrf token')
      )
  }

  /**
    * Session id by usrname and password
    * @param {String} username
    * @param {String} password
    * @return {Object} Promise
  */
  auth(username, password) {
    var formdata = 'username=' + username + '&password=' + password + '&queryParams=%7B%22source%22%3A%22auth_switcher%22%7D' + '&optIntoOneTap=false'

    var options = {
      method: 'POST',
      body: formdata,
      headers:
        this.combineWithBaseHeader(
          {
            'accept': '*/*',
            'accept-encoding': 'gzip, deflate, br',
            'content-length': formdata.length,
            'content-type': 'application/x-www-form-urlencoded',
            'cookie': 'ig_cb=' + this.essentialValues.ig_cb,
            'x-csrftoken': this.csrfToken,
            'x-instagram-ajax': this.rollout_hash,
            'x-requested-with': 'XMLHttpRequest',
          }
        )
    }

    return fetch('https://www.instagram.com/accounts/login/ajax/', options).then(
      async (t) => {
        await this.updateEssentialValues(t.headers._headers['set-cookie']);
        // 2FA
        let response = await t.json();
        if ( t.status == 400 ) {
          if ( response.two_factor_required ) {
            this.twoFactorRequired = true;
            this.lastFourDigit = response.two_factor_info.obfuscated_phone_number;
            this.twoFactorIdentifier = response.two_factor_info.two_factor_identifier;

            return {
              status: '2fa',
              response
            }
          } else {
            return {
              status: 'blocked',
              response
            };
          }
        }
        if ( ("authenticated" in response && response.authenticated == false) 
          || ("user" in response && response.user == false) ) {
          return {
            status : "fail",
            error_type : "user_not_found",
            message : "Username or password is incorrect!"
          }
        } else {
          return {
            status : "success",
            sessionId : this.essentialValues.sessionid
          };
        }
      }).catch(() =>
        console.log('Instagram authentication failed (challenge required erro)')
      )
  }

  /**
      * Registration for instagram, returning true or false
      * true if account was successfully created
      * @param {String} username
      * @param {String} password
      * @param {String} name
      * @param {String} email
      * @return {Boolen} account_created
      */
  reg(username, password, name, email) {
    let form = new formData();
    form.append('username', username)
    form.append('password', password)
    form.append('firstname', name)
    form.append('email', email)
    form.append('seamless_login_enabled', "1")

    return fetch('https://www.instagram.com/accounts/web_create_ajax/', {
      'method': 'post',
      'body': form,
      'headers': {
        'referer': 'https://www.instagram.com/',
        'origin': 'https://www.instagram.com',
        'user-agent': this.userAgent,
        'x-instagram-ajax': '1',
        'x-requested-with': 'XMLHttpRequest',
        'x-csrftoken': this.csrfToken,
        cookie: 'csrftoken=' + this.csrfToken
      }
    })
      .then(res => res.json())
      .then(json => {
        //console.log(json.errors);
        return json.account_created;
      })
      .catch(() => console.log('Instagram registration failed'))
  }


  /**
    * Follow/unfollow user by id
    * @param {int} userID
    * @param {boolean} isUnfollow
    * @return {object} Promise of fetch request
  */
  follow(userId, username = null) {
    return fetch('https://www.instagram.com/web/friendships/' + userId + '/follow/',
      {
        'method': 'POST',
        'headers': {
                    'accept': '*/*',
                    'accept-encoding' : 'gzip, deflate, br',
                    'accept-language' : 'en-US,en;q=0.9,fil;q=0.8',
                    'content-length' : 0,
                    'content-type': 'application/json; charset=utf-8',
                    'origin' : 'https://www.instagram.com',
                    'referer' : username ? 'https://www.instagram.com/' + username : 'https://www.instagram.com/',
                    'sec-fetch-mode' : 'cors',
                    'sec-fetch-site' : 'same-origin',
                    'user-agent' : this.userAgent,
                    'x-csrftoken': this.csrfToken,
                    'x-requested-with': 'XMLHttpRequest',
                    'x-instagram-ajax': '1',
                    'cookie': this.generateCookie()
                  }
      }).then(t =>
        t.json().then(r => r)
      )
      .catch((err) => console.log('Instagram follow failed'))
  }

  /**
    * Follow/unfollow user by id
    * @param {int} userID
    * @param {boolean} isUnfollow
    * @return {object} Promise of fetch request
  */
  unfollow(userId, username = null) {
    return fetch('https://www.instagram.com/web/friendships/' + userId + '/unfollow/',
      {
        'method': 'POST',
        'headers': this.combineWithBaseHeader(
                        {
                          'accept': '*/*',
                          'accept-encoding': 'gzip, deflate, br',
                          'content-type': 'application/x-www-form-urlencode',
                          'x-requested-with': 'XMLHttpRequest',
                          'x-instagram-ajax': '1',
                          'x-csrftoken': this.csrfToken,
                          'referer' : username ? 'https://www.instagram.com/' + username : 'https://www.instagram.com',
                          'cookie': this.generateCookie()
                        }
                    )
      }).then(t =>
        t.json().then(r => r)
      )
      .catch((err) => console.log('Instagram unfollow failed'))
  } 

  followHashtags(hashTags) {
    return fetch('https://www.instagram.com/web/tags/follow/' + hashTags,
      {
        'method': 'post',
        'headers': this.getHeaders()//headers
      }).then(res => {
        return res;
      });
  }

  unfollowHashtags(hashTags) {
    return fetch('https://www.instagram.com/web/tags/unfollow/' + hashTags,
      {
        'method': 'post',
        'headers': this.getHeaders()//headers
      }).then(res => {
        return res;
      });
  }

  getCommentsByPostId(postId) {
    var fetch_data = {
      'method': 'get',
      'headers':
        this.combineWithBaseHeader(
          {
            'accept': 'text/html,application/xhtml+xml,application/xml;q0.9,image/webp,image/apng,*.*;q=0.8',
            'accept-encoding': 'gzip, deflate, br',
            'cookie': this.generateCookie()
          }
        )
    }

    return fetch('https://www.instagram.com/p/' + postId, fetch_data).then(res => res.text().then(function (data) {
      const regex = /window\._sharedData = (.*);<\/script>/;
      const match = regex.exec(data);
      if (typeof match[1] === 'undefined') {
        return '';
      }
      return JSON.parse(match[1]).entry_data.PostPage[0].graphql.shortcode_media.edge_media_to_parent_comment;
      //            return JSON.parse(match[1]);
    }));
  }


  /**
    * @return {Object} default headers
   */
  getHeaders() {
    return {
      'referer': 'https://www.instagram.com/p/BT1ynUvhvaR/?taken-by=yatsenkolesh',
      'origin': 'https://www.instagram.com',
      'user-agent': this.userAgent,
      'x-instagram-ajax': '1',
      'x-requested-with': 'XMLHttpRequest',
      'x-csrftoken': this.csrfToken,
      cookie: ' sessionid=' + this.sessionId + '; csrftoken=' + this.csrfToken + ';'
    }
  }

  /**
    * Return user data by id
    * @param {Int} id
    * @return {Object} promise
  */
  getUserDataById(id) {
    let query = 'ig_user(' + id + '){id,username,external_url,full_name,profile_pic_url,biography,followed_by{count},follows{count},media{count},is_private,is_verified}'

    let form = new formData();
    form.append('q', query)

    return fetch('https://www.instagram.com/query/',
      {
        'method': 'post',
        'body': form,
        'headers': this.getHeaders()
      }).then(res =>
        res.json().then(t => t)
      )
  }

  /**
    * When you pass items counter param instagram create pagination
    * tokens on all iterations and gives on every response end_cursor, which the need to pass on next feed request
    *
    * This method return first "items" posts of feed
    * Coming soon will be opportunity  for get part of feed
    * On testing stage (+- all rights)
    * If you have a problems - create issue : https://github.com/yatsenkolesh/instagram-nodejs
    * @param {Int} items (default - 10)
    * @return {Object} Promise
  */
  getFeed(items = 10, cursor) {
    const gqlVars = {
      // cached_feed_item_ids: [],
      fetch_media_item_count: items,
      fetch_media_item_cursor: cursor,
      // fetch_comment_count:10,
      // fetch_like:3,
      // has_stories:false,
      // has_threaded_comments:true,
    }

    // {"cached_feed_item_ids":[],"fetch_media_item_count":12,"fetch_media_item_cursor":"KGEAhFCAQu_Wax1GGCLLBd5qHcsFAsfWbGwdS1UXhHP4aB3S-IFfYEZqHVJ1HGWdVGsdW8uEZmK_ax0ubChVlE0AAPFiBjC2HWsdOJ4ewkXBaB17awNZFvxqHT2_tge5RQAAFuaQvPGaWyoUBAA=","fetch_comment_count":4,"fetch_like":3,"has_stories":false,"has_threaded_comments":true}

    return fetch('https://www.instagram.com/graphql/query/?query_hash=08574cc2c79c937fbb6da1c0972c7b39&variables=' + encodeURIComponent(JSON.stringify(gqlVars)),
      {
        headers: this.combineWithBaseHeader(
          {
            'accept': '*/*',
            'accept-encoding': 'gzip, deflate, br',
            'cookie': this.generateCookie()
          }
        ),
      }).then(t =>
        // console.log(t)
        t.json().then(r => r)
      )
  }

  /**
    * Simple variable for get next page
    * @param {Object} json contents from this.getFeed
    * @return {String} if next page is not exists - false
  */
  getFeedNextPage(json) {
    let page = json.data.user.edge_web_feed_timeline.page_info

    return page.has_next_page ? page.end_cursor : false
  }

  /**
    * Attention: postId need transfer only as String (reason int have max value - 2147483647)
    * @example postID - '1510335854710027921'
    * @param {String} post id
    * @return {Object} Promse
  */
  like(postId, shortcode = null) {
    return fetch('https://www.instagram.com/web/likes/' + postId + '/like/',
      {
        'method': 'POST',
        'headers': {
                    'accept': '*/*',
                    'accept-encoding' : 'gzip, deflate, br',
                    'accept-language' : 'en-US,en;q=0.9,fil;q=0.8',
                    'content-length' : 0,
                    'content-type': 'application/json; charset=utf-8',
                    'origin' : 'https://www.instagram.com',
                    'referer' : shortcode ? 'https://www.instagram.com/p/' + shortcode + '/' : 'https://www.instagram.com',
                    'sec-fetch-mode' : 'cors',
                    'sec-fetch-site' : 'same-origin',
                    'user-agent' : this.userAgent,
                    'x-csrftoken': this.csrfToken,
                    'x-requested-with': 'XMLHttpRequest',
                    'x-instagram-ajax': '1',
                    'cookie': this.generateCookie()
                  }
      }).then(t =>
        t.json().then(r => r)
      )
  }

  /**
    * Attention: postId need transfer only as String (reason int have max value - 2147483647)
    * @example postID - '1510335854710027921'
    * @param {String} postId
    * @return {Object} Promse
  */
  unlike(postId) {
    return fetch('https://www.instagram.com/web/likes/' + postId + '/unlike/',
      {
        'method': 'POST',
        'headers': this.getHeaders()
      }).then(t =>
        t.json().then(r => r)
      )
  }

  /**
    * Attention: postId need transfer only as String (reason int have max value - 2147483647)
    * @example postID - '1510335854710027921'
    * @param {String} post id
    * @return {Object} Promse
  */
  likeComment(commentId, shortcode) {
    return fetch('https://www.instagram.com/web/comments/like/' + commentId + '/',
      {
        'method': 'POST',
        'headers': this.combineWithBaseHeader(
                        {
                          'accept': '*/*',
                          'accept-encoding': 'gzip, deflate, br',
                          'content-type': 'application/x-www-form-urlencode',
                          'x-requested-with': 'XMLHttpRequest',
                          'x-csrftoken': this.csrfToken,
                          'referer' : 'https://www.instagram.com/p/' + shortcode + '/',
                          'cookie': this.generateCookie()
                        }
                    )
      }).then(t =>
        t.json().then(r => r)
      )
  }

  /**
    * Attention: postId need transfer only as String (reason int have max value - 2147483647)
    * @example postID - '1510335854710027921'
    * @param {String} postId
    * @return {Object} Promse
  */
  unlikeComment(commentId) {
    return fetch('https://www.instagram.com/web/comments/unlike/' + commentId,
      {
        'method': 'POST',
        'headers': this.getHeaders()
      }).then(t =>
        t.json().then(r => r)
      )
  }



  /**
    * @example url = https://www.instagram.com/p/BT1ynUvhvaR/
    * @param {String} url
    * @return {Object} Promise
  */
  getMediaInfoByUrl(url) {
    return fetch('https://api.instagram.com/oembed/?url=' + url,
      {
        'headers': this.getHeaders()
      }).then(t => t.json().then(r => r))
  }

  /**
    * @example url = https://www.instagram.com/p/BT1ynUvhvaR/
    * @param {String} url
    * @return {Object} Promise
  */
  getMediaIdByUrl(url) {
    return this.getMediaInfoByUrl(url).then(t => t.media_id.split('_')[0])
  }

  /**
    * Get media user list on userId with pagination
    * @param {String} userId
    * @param {String} cursor (next cursor). Use 0, if you want to get first page
    * @param {Int} mediaCounter default - 12
    * @return {Object} Promise
  */
  getUserMedia(userId, cursor, mediaCounter) {
    cursor = cursor ? cursor : '0'
    mediaCounter = mediaCounter ? mediaCounter : 12
    let form = new formData()
    form.append('q', 'ig_user(' + userId + ') { media.after(' + cursor + ', ' + mediaCounter + ') {\
    count,\
    nodes {\
      __typename,\
      caption,\
      code,\
      comments {\
        count\
      },\
      comments_disabled,\
      date,\
      dimensions {\
        height,\
        width\
      },\
      display_src,\
      id,\
      is_video,\
      likes {\
        count\
      },\
      owner {\
        id\
      },\
      thumbnail_src,\
      video_views\
    },\
    page_info\
    }\
   }')
    form.append('ref', 'users::show')
    form.append('query_id', '17849115430193904') // this is static id. May be changed after rebuild, but now actually

    return fetch('https://www.instagram.com/query/',
      {
        headers: this.getHeaders(),
        method: 'post',
        body: form
      }).then(r => r.text().then(t => t))
  }

  /**
    * End cursor - t.entry_data.TagPage[0].tag.media.page_info['end_cursor']
    * Media(nodes) - t.entry_data.TagPage[0].tag.media['nodes']
    * @param {String} searchBy - location, hashtag
    * @param {String} q - location id, or hashtag
    * @param {String} cursor pagination cursor
    * @param {Int} mediaCounter
    * @return {Object} Promise
  */
  searchBy(searchBy, q, cursor, mediaCounter) {
    if (this.searchTypes.indexOf(searchBy) === false)
      throw 'search type ' + searchBy + ' is not found'

    //exclusion for hashtag if not cursor
    if (searchBy == 'hashtag' && !cursor) {
      return fetch('https://www.instagram.com/explore/tags/' + q + '/',
        {
          headers: this.getHeaders(),
        }).then(t => t.text().then(r => JSON.parse(r.match(/\<script type=\"text\/javascript\">window\._sharedData \=(.*)\;<\//)[1])))
    }

    let form = new formData()
    mediaCounter = mediaCounter ? mediaCounter : 12
    form.append('q', 'ig_' + searchBy + '(' + q + ') { media.after(' + cursor + ', ' + mediaCounter + ') {\
      count,\
      nodes {\
        __typename,\
        caption,\
        code,\
        comments {\
          count\
        },\
        comments_disabled,\
        date,\
        dimensions {\
          height,\
          width\
        },\
        display_src,\
        id,\
        is_video,\
        likes {\
          count\
        },\
        owner {\
          id\
        },\
        thumbnail_src,\
        video_views\
      },\
      page_info\
    }\
     }')

    form.append('ref', 'locations::show')
    form.append('query_id', '') //empty


    return fetch('https://www.instagram.com/query/',
      {
        headers: this.getHeaders(),
        method: 'post',
        body: form
      }).then(t => t.json().then(r => r))
  }

  /**
    * Place id path - r.places[0].place.location['pk'], r.places[1].place.location['pk'], ...
    * Common search returned locations, hashtags and users
    * @param {String} q
    * @return {Object} Promise
  */
  commonSearch(q, rankToken) {
    rankToken = rankToken ? rankToken : ''
    return fetch('https://www.instagram.com/web/search/topsearch/?context=blended&query=' + q + '&rank_token=' + rankToken,
      {
        headers: this.getHeaders() // no required
      }).then(t => t.json().then(r => r))
  }

  /**
    * Simple variable for get next page
    * @param {Object} json contents from this.getFeed
    * @return {String} if next page is not exists - false
  */
  getNextPageCursor(json) {
    let page = json.page_info

    return page.has_next_page ? page.end_cursor : false
  }

  async getLikersByPostId(postId, limit = 10) {
    const gqlVars = {
      shortcode: postId,
      include_reel: true,
      first: limit,
    }

    return await fetch('https://www.instagram.com/graphql/query/?query_hash=d5d763b1e2acf209d62d22d184488e57&variables=' + encodeURIComponent(JSON.stringify(gqlVars)),
      {
        headers: this.getHeaders()
      })
      .then(r => r.json());
  }
  
  searchBar(q, context = null, rankToken = null) {
    const rankTokenQuery = rankToken ? '&rank_token=' + rankToken : '';

      return fetch('https://www.instagram.com/web/search/topsearch/?context='+(context ? context : 'blended')+'&query=' + q + rankTokenQuery,
      {
        headers: this.getHeaders() // no required
      }).then(t => t.json().then(r => r));
  }

  getPlaces(q, rankToken = null) {
    const rankTokenQuery = rankToken ? '&rank_token=' + rankToken : '';

      return fetch('https://www.instagram.com/web/search/topsearch/?context=place&query=' + q + rankTokenQuery,
      {
        headers: this.getHeaders() // no required
      }).then(t => t.json().then(r => r));
  }
  
  getPostByLocation(locationId, endCursor, count) {
    count = count || 12;

    const query = {
      id: locationId,
      after: endCursor,
      first: count,
    }

    if (endCursor) {
      query.after = endCursor;
    }

    return fetch('https://www.instagram.com/graphql/query/?query_hash=1b84447a4d8b6d6d0426fefb34514485&variables=' + encodeURIComponent(JSON.stringify(query)),
    {
      headers: this.getHeaders()
    }).then(r => r.json());
  }

  getPostDetails(shortcode) {
    const query = {
      shortcode: shortcode
    }
    return fetch('https://www.instagram.com/graphql/query/?query_hash=865589822932d1b43dfe312121dd353a&variables=' + encodeURIComponent(JSON.stringify(query)),
    {
      headers: this.getHeaders()
    }).then(r => r.json());
  }

  twoFactorAuth(code, data) {
    // var formdata = 'username=' + data.username + '&verificationCode=' + code + '&identifier=' + data.twoFactorIdentifier
    var formdata = 'username=bobieistrafaguf&verificationCode=349867&identifier=nbeRPtsfTd';
    
    var options = {
      method: 'POST',
      body: formdata,
      headers: this.combineWithBaseHeader(
          {
            'accept': '*/*',
            'accept-encoding': 'gzip, deflate, br',
            'csrftoken' : 'ZEgidLgqciQ4hPSjooVg6K0V53aVFwnp',
            'referer' : "https://www.instagram.com/accounts/login/two_factor?next=%2F",
            'origin': "https://www.instagram.com",
            'cookie': "mid=XWDgWAAEAAHvy6t-pgdGXMCmlELy; fbm_124024574287414=base_domain=.instagram.com; datr=zfuHXbIrb7mAf-I1iRypi9EU; shbid=14149; shbts=1569200722.3405263; csrftoken=ZEgidLgqciQ4hPSjooVg6K0V53aVFwnp; rur=VLL; fbsr_124024574287414=dlslA5xZdV3yjxYlFdDlgXUbYrzOPQGNTTh0dl2-cYg.eyJ1c2VyX2lkIjoiMTAwMDAwMjQ0NTgyOTc5IiwiY29kZSI6IkFRRGN6b2luX184dVQxSEpQQWRlTmFVWEp0Y2d6T0hsTnRpOGpBMFkyZGZXbFp1WVFSOEFocXRnZlFwZzRJYTF3WDhPNFdiUWxpbTFDWUloZi1XZFhob1NCMUFhZGU2TXJrV20tdGwzejdFQjIxVExRT3NjMFllX28wQm0xTHhEWXp4OXY3Q2RpS0IwYzZZRnB0d2tyT3AtYkZpUkZjTm9waWdoR1pBX3BPUzN3WDlNUXVXZ2RlME9NTUdJRFhxYTYwMGRsZ1FKMnNuRlJxeVhYd29HODFZZVFlZWUza2J3enNVb3doU2I5clRQcHJZaHlEeURyc3lMOUhfQWc4bjFjMk9MQVlHa0N5eFFmNnliU19QbkJoMVRjUFJxVU92MHA1aHp0LWt4R3dlODlQUHJKTWdvZ3Z2Vi1HbklkRTZHOVJZRnU2bGlMdnJhZzBZU1BQQkN3cEloIiwib2F1dGhfdG9rZW4iOiJFQUFCd3pMaXhuallCQUZpcFNZV3pjQnNJRzRhV1pDeTNTc3lybk5VWkNaQkZpS1BZMlFocGZBZlpDWkFXa3dXNHIxQVVGUTR0WEZBU2FsdVpCZlZUWHZzVkJoeUdSZXBUMEVHbWxIRFNGZ25TbXAxTFdZZTdBb3hvN2pvR25sTDVROGZHYlBhRXphR05TU2hZZjFtdVFmWEZ0SVVrNmxGRXBHVmV0VmdKNzFnTTZMTHRrcFQxUHYiLCJhbGdvcml0aG0iOiJITUFDLVNIQTI1NiIsImlzc3VlZF9hdCI6MTU2OTI5NDc5NX0; urlgen=\"{\"124.104.179.197\": 9299}:1iCbGd:gBkP5m7nCRWwroNRrAfxIKtc48A\""
          })
    }

    return fetch('https://www.instagram.com/accounts/login/ajax/two_factor/', options).then(
      async (t) => {
        console.log(t);
      }).catch(() =>
        console.log('Instagram authentication failed (challenge required erro)')
      )
  }

  loadPage(page, headers) {
    return fetch('https://www.instagram.com'+page,
      {
        'method': 'get',
        'headers': {
          'accept':'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3',
          'accept-encoding' : 'gzip, deflate, br',
          'accept-language' : 'en-US,en;q=0.9,fil;q=0.8',
          'cookie' : this.generateCookie(),
          'sec-fetch-mode' : 'navigate',
          'sec-fetch-site' : 'none',
          'upgrade-insecure-requests' : '1',
          'user-agent' : this.userAgent
        }
      }).then(t => t.text())
      .catch(() => console.log('Page "'+page+'" does not exist'));
  }
}
