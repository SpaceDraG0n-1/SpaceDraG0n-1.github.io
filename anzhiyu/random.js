var posts=["posts/16109.html","posts/11.html","posts/16113.html","posts/16122.html","posts/16111.html","posts/16110.html","posts/16108.html","posts/12.html"];function toRandomPost(){
    pjax.loadUrl('/'+posts[Math.floor(Math.random() * posts.length)]);
  };