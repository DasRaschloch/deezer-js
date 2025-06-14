const got = require('got')
const {map_artist_album, map_user_track, map_user_artist, map_user_album, map_user_playlist} = require('./utils.js')
const { GWAPIError } = require('./errors.js')

const PlaylistStatus = {
  PUBLIC: 0,
  PRIVATE: 1,
  COLLABORATIVE: 2,
}

const EMPTY_TRACK_OBJ = {
  SNG_ID: 0,
  SNG_TITLE: '',
  DURATION: 0,
  MD5_ORIGIN: 0,
  MEDIA_VERSION: 0,
  FILESIZE: 0,
  ALB_TITLE: "",
  ALB_PICTURE: "",
  ART_ID: 0,
  ART_NAME: ""
}

class GW{
  constructor(cookie_jar, headers){
    this.http_headers = headers
    this.cookie_jar = cookie_jar
    this.api_token = null
  }

  async api_call(method, args, params){
    if (typeof args === undefined) args = {}
    if (typeof params === undefined) params = {}
    if (!this.api_token && method != 'deezer.getUserData') this.api_token = await this._get_token()
    let p = {
      api_version: "1.0",
      api_token: method == 'deezer.getUserData' ? 'null' : this.api_token,
      input: '3',
      method: method,
      ...params
    }
    await new Promise(r => setTimeout(r, Math.floor(Math.random() * 50) + 100));
    const maxRetries = 4
    let delay = 5000
    let attempt = 0
    let result_json
    while (attempt < maxRetries){
      try{
        result_json = await got.post("http://www.deezer.com/ajax/gw-light.php", {
          searchParams: p,
          json: args,
          cookieJar: this.cookie_jar,
          headers: this.http_headers,
          https: {
            rejectUnauthorized: false
          },
          timeout: 30000
        }).json()
        break
      }catch (e){
        if (attempt < maxRetries-1 && e.response && (e.response.statusCode === 403 || e.response.statusCode === 429)){
          console.log(`${new Date().toISOString()} Rate limit detected, slowing down for ${delay}ms. Attempt ${attempt+1} of ${maxRetries}`);
          await new Promise(r => setTimeout(r, delay))
          attempt++
          delay *= 2
          continue
        }
        console.debug("[ERROR] deezer.gw", method, args, e.name, e.message)
        if (["ECONNABORTED", "ECONNREFUSED", "ECONNRESET", "ENETRESET", "ETIMEDOUT"].includes(e.code)){
          await new Promise(r => setTimeout(r, 2000)) // sleep(2000ms)
          return this.api_call(method, args, params)
        }
        throw new GWAPIError(`${method} ${args}:: ${e.name}: ${e.message}`)
      }
    }
    if (result_json.error.length || Object.keys(result_json.error).length) {
      if (
        JSON.stringify(result_json.error) == '{"GATEWAY_ERROR":"invalid api token"}' ||
        JSON.stringify(result_json.error) == '{"VALID_TOKEN_REQUIRED":"Invalid CSRF token"}'
      ){
        this.api_token = await this._get_token()
        return this.api_call(method, args, params)
      }
      if (result_json.payload && result_json.payload.FALLBACK){
        Object.keys(result_json.payload.FALLBACK).forEach(key => {
          args[key] = result_json.payload.FALLBACK[key]
        })
        return this.api_call(method, args, params)
      }
      throw new GWAPIError(JSON.stringify(result_json.error))
    }
    if (!this.api_token && method == 'deezer.getUserData') this.api_token = result_json.results.checkForm
    return result_json.results
  }

  async _get_token(){
    let token_data = await this.get_user_data()
    return token_data.checkForm
  }

  get_user_data(){
    return this.api_call('deezer.getUserData')
  }

  get_user_profile_page(user_id, tab, options={}){
    const limit = options.limit || 10
    return this.api_call('deezer.pageProfile', {USER_ID: user_id, tab, nb: limit})
  }

  get_user_favorite_ids(checksum = null, options={}){
    const limit = options.limit || 10000
    const start = options.start || 0
    return this.api_call('song.getFavoriteIds', {nb: limit, start, checksum})
  }

  get_child_accounts(){
    return this.api_call('deezer.getChildAccounts')
  }

  get_track(sng_id){
    return this.api_call('song.getData', {SNG_ID: sng_id})
  }

  get_track_page(sng_id){
    return this.api_call('deezer.pageTrack', {SNG_ID: sng_id})
  }

  get_track_lyrics(sng_id){
    return this.api_call('song.getLyrics', {SNG_ID: sng_id})
  }

  async get_tracks(sng_ids){
    let tracks_array = []
    let body = await this.api_call('song.getListData', {SNG_IDS: sng_ids})
    let errors = 0
    for (let i = 0; i < sng_ids.length; i++){
      if (sng_ids[0] != 0){
        tracks_array.push(body.data[i - errors])
      } else {
        errors++
        tracks_array.push(EMPTY_TRACK_OBJ)
      }
    }
    return tracks_array
  }

  get_album(alb_id){
    return this.api_call('album.getData', {ALB_ID: alb_id})
  }

  get_album_page(alb_id){
    return this.api_call('deezer.pageAlbum', {
      ALB_ID: alb_id,
      lang: 'en',
      header: true,
      tab: 0
    })
  }

  async get_album_tracks(alb_id){
    let tracks_array = []
    let body = await this.api_call('song.getListByAlbum', {ALB_ID: alb_id, nb: -1})
    body.data.forEach(track => {
      let _track = track
      _track.POSITION = body.data.indexOf(track)
      tracks_array.push(_track)
    })
    return tracks_array
  }

  get_artist(art_id){
    return this.api_call('artist.getData', {ART_ID: art_id})
  }

  get_artist_page(art_id){
    return this.api_call('deezer.pageArtist', {
      ART_ID: art_id,
      lang: 'en',
      header: true,
      tab: 0
    })
  }

  async get_artist_top_tracks(art_id, options={}){
    const limit = options.limit || 100
    let tracks_array = []
    let body = await this.api_call('artist.getTopTrack', {ART_ID: art_id, nb: limit})
    body.data.forEach(track => {
      track.POSITION = body.data.indexOf(track)
      tracks_array.push(track)
    })
    return tracks_array
  }

  get_artist_discography(art_id, options={}){
    const index = options.index || 0
    const limit = options.limit || 25
    return this.api_call('album.getDiscography', {
      ART_ID: art_id,
      discography_mode:"all",
      nb: limit,
      nb_songs: 0,
      start: index
    })
  }

  get_playlist(playlist_id){
    return this.get_playlist_page(playlist_id)
  }

  get_playlist_page(playlist_id){
    return this.api_call('deezer.pagePlaylist', {
      PLAYLIST_ID: playlist_id,
      lang: 'en',
      header: true,
      tab: 0
    })
  }

  async get_playlist_tracks(playlist_id){
    let tracks_array = []
    let body = await this.api_call('playlist.getSongs', {PLAYLIST_ID: playlist_id, nb: -1})
    body.data.forEach(track => {
      track.POSITION = body.data.indexOf(track)
      tracks_array.push(track)
    })
    return tracks_array
  }

  create_playlist(title, status=PlaylistStatus.PUBLIC, description, songs=[]){
    let newSongs = []
    songs.forEach(song => {
      newSongs.push([song, 0])
    });
    return this.api_call('playlist.create', {
      title,
      status,
      description,
      songs: newSongs
    })
  }

  edit_playlist(playlist_id, title, status, description, songs=[]){
    let newSongs = []
    songs.forEach(song => {
      newSongs.push([song, 0])
    });
    return this.api_call('playlist.update', {
      PLAYLIST_ID: playlist_id,
      title,
      status,
      description,
      songs: newSongs
    })
  }

  add_songs_to_playlist(playlist_id, songs, offset=-1){
    let newSongs = []
    songs.forEach(song => {
      newSongs.push([song, 0])
    });
    return this.api_call('playlist.addSongs', {
      PLAYLIST_ID: playlist_id,
      songs: newSongs,
      offset
    })
  }

  add_song_to_playlist(playlist_id, sng_id, offset=-1){
    return this.add_songs_to_playlist(playlist_id, [sng_id], offset)
  }

  remove_songs_from_playlist(playlist_id, songs){
    let newSongs = []
    songs.forEach(song => {
      newSongs.push([song, 0])
    });
    return this.api_call('playlist.deleteSongs', {
        PLAYLIST_ID: playlist_id,
        songs: newSongs
    })
  }

  remove_song_from_playlist(playlist_id, sng_id){
    return this.remove_songs_from_playlist(playlist_id, [sng_id])
  }

  delete_playlist(playlist_id){
    return this.api_call('playlist.delete', {PLAYLIST_ID: playlist_id})
  }

  add_song_to_favorites(sng_id){
    return this.gw_api_call('favorite_song.add', {SNG_ID: sng_id})
  }

  remove_song_from_favorites(sng_id){
    return this.gw_api_call('favorite_song.remove', {SNG_ID: sng_id})
  }

  add_album_to_favorites(alb_id){
    return this.gw_api_call('album.addFavorite', {ALB_ID: alb_id})
  }

  remove_album_from_favorites(alb_id){
    return this.gw_api_call('album.deleteFavorite', {ALB_ID: alb_id})
  }

  add_artist_to_favorites(art_id){
    return this.gw_api_call('artist.addFavorite', {ART_ID: art_id})
  }

  remove_artist_from_favorites(art_id){
    return this.gw_api_call('artist.deleteFavorite', {ART_ID: art_id})
  }

  add_playlist_to_favorites(playlist_id){
    return this.gw_api_call('playlist.addFavorite', {PARENT_PLAYLIST_ID: playlist_id})
  }

  remove_playlist_from_favorites(playlist_id){
    return this.gw_api_call('playlist.deleteFavorite', {PLAYLIST_ID: playlist_id})
  }

  get_page(page){
    let params = {
      gateway_input: JSON.stringify({
        PAGE: page,
        VERSION: '2.3',
        SUPPORT: {
          grid: [
            'channel',
            'album'
          ],
          'horizontal-grid': [
            'album'
          ],
        },
        LANG: 'en'
      })
    }
    return this.api_call('page.get', {}, params)
  }

  search(query, index=0, limit=10, suggest=true, artist_suggest=true, top_tracks=true){
    return this.api_call('deezer.pageSearch', {
      query,
      start: index,
      nb: limit,
      suggest,
      artist_suggest,
      top_tracks
    })
  }

  search_music(query, type, options={}){
    const index = options.index || 0
    const limit = options.limit || 10
    return this.api_call('search.music', {
      query,
      filter: "ALL",
      output: type,
      start: index,
      nb: limit
    })
  }

  // Extra calls

  async get_artist_discography_tabs(art_id, options={}){
    const limit = options.limit || 100
    let index = 0
    let releases = []
    let result = {all: []}
    let ids = []

    // Get all releases
    let response
    do {
      response = await this.get_artist_discography(art_id, {index, limit})
      releases = releases.concat(response.data)
      index += limit
    } while (index < response.total)

    releases.forEach(release => {
      if (ids.indexOf(release.ALB_ID) == -1){
        ids.push(release.ALB_ID)
        let obj = map_artist_album(release)
        if ((release.ART_ID == art_id || release.ART_ID != art_id && release.ROLE_ID == 0) && release.ARTISTS_ALBUMS_IS_OFFICIAL){
          // Handle all base record types
          if (!result[obj.record_type]) result[obj.record_type] = []
          result[obj.record_type].push(obj)
          result.all.push(obj)
        } else {
          if (release.ROLE_ID == 5) { // Handle albums where the artist is featured
            if (!result.featured) result.featured = []
            result.featured.push(obj)
          } else if (release.ROLE_ID == 0) { // Handle "more" albums
            if (!result.more) result.more = []
            result.more.push(obj)
            result.all.push(obj)
          }
        }
      }
    })
    return result
  }

  async get_track_with_fallback(sng_id){
    let body
    if (parseInt(sng_id) > 0){
      try{ body = await this.get_track_page(sng_id) }
      catch (e) { /*nothing*/ }
    }

    if (body){
      if (body.LYRICS) body.DATA.LYRICS = body.LYRICS
      if (body.ISRC) body.DATA.ALBUM_FALLBACK = body.ISRC
      body = body.DATA
    } else {
      body = await this.get_track(sng_id)
    }
    return body
  }

  async get_user_playlists(user_id, options={}){
    const limit = options.limit || 25
    let user_profile_page = await this.get_user_profile_page(user_id, 'playlists', {limit})
    let blog_name = user_profile_page.DATA.USER.BLOG_NAME || "Unknown"
    let data = user_profile_page.TAB.playlists.data
    let result = []
    data.forEach(playlist => {
      result.push(map_user_playlist(playlist, blog_name))
    })
    return result
  }

  async get_user_albums(user_id, options={}){
    const limit = options.limit || 25
    let data = await this.get_user_profile_page(user_id, 'albums', {limit})
    data = data.TAB.albums.data
    let result = []
    data.forEach(album => {
      result.push(map_user_album(album))
    })
    return result
  }

  async get_user_artists(user_id, options={}){
    const limit = options.limit || 25
    let data = await this.get_user_profile_page(user_id, 'artists', {limit})
    data = data.TAB.artists.data
    let result = []
    data.forEach(artist => {
      result.push(map_user_artist(artist))
    })
    return result
  }

  async get_user_tracks(user_id, options={}){
    let user_data = await this.get_user_data()
    if (user_data.USER.USER_ID == user_id) return this.get_my_favorite_tracks(options)
    const limit = options.limit || 25
    let data = this.get_user_profile_page(user_id, 'loved', {limit})
    data = data.TAB.loved.data
    let result = []
    data.forEach(track => {
      result.push(map_user_track(track))
    })
    return result
  }

  async get_my_favorite_tracks(options={}){
    const limit = options.limit || 25
    const ids_raw = await this.get_user_favorite_ids(null, {limit})
    const ids = ids_raw.data.map(x => x.SNG_ID)
    if (!ids.length) return []
    let data = await this.get_tracks(ids)
    let result = []
    let i = 0
    data.forEach((track) => {
      if (!track) return
      while (track.SNG_ID != ids[i]) i++
      track = {...track, ...ids_raw.data[i]}
      result.push(map_user_track(track))
      i++
    })
    return result
  }

}

module.exports = {
  PlaylistStatus,
  EMPTY_TRACK_OBJ,
  GW
}
