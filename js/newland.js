//menu nav background-color if scrolled

$(document).scroll(function(e) {
 $(window).scrollTop() > 100 ? $('.header-menu-pc').addClass('nav__color') : $('.header-menu-pc').removeClass('nav__color');
});

// button intro

$('.menu-btn').on('click', function(e) {
  e.preventDefault();
  $('.menu').toggleClass('menu_active');
  $('.content').toggleClass('content_active');
});

$('.menu-btn').on('click', function(m) {
 m.preventDefault();
 $(this).toggleClass('menu-btn_active');
});

//button menu main

$('.menu-close-btn').on('click', function(u) {
 u.preventDefault();
 $('.menu').removeClass('menu_active');
 $('.content').removeClass('content_active');
 $('.menu-btn').removeClass('menu-btn_active'); });

//button want bay

$('.btn-neon').on('click', function(e) {
 e.preventDefault();
 $('.modal-s__main').toggleClass('show');
});

// btn want bay design


$('.btn-design').on('click', function(e) {
 e.preventDefault();
 $('.modal-s__main').toggleClass('show');
});

// modal button
$('._modal').on('click', function(e) {
 e.preventDefault();
 $('.modal-s__main').addClass('show');
});

//$('.btn-bay').click ( function() 
//  $('.mainfoto').removeClass('wow zoomIn');
 //   $('p').removeClass('wow zoomInUp');
 //   new WOW().init();
   // $(this).toggleClass('wow hinge ');

  
//});
//burger click portfolio
$('#portfolio_burger').on('click', function(u) {
  u.preventDefault();
  $('.menu').removeClass('menu_active');
  jQuery.scrollTo('#portfolio', 400, { offset: -150 });
});


$('.modal-btn').on('click', function(e) {
  e.preventDefault();
  $('.modal-s__main').removeClass('show');
  //$('.body').removeClass('no-scroll');
});


//first slider owl corusel 2
$(document).ready(function() {

 $(function() {
  // Owl Carousel
 $(".owl-carousel").owlCarousel({
   items: 1,
   margin: 0,
   loop: true,
   nav: false,
   navSpeed: 500,
   dots: false
  });
  
  var owl = $(".anim");
  owl.owlCarousel();
  $('.js-owl-prev').click(function() {
   owl.trigger('next.owl.carousel');
  });
  $('.js-owl-next').click(function() {
   owl.trigger('prev.owl.carousel');
  });
 });
});


// first slider animation

$(document).ready(function() {

 // Declare Carousel jquery object
 var owl = $('.anim');

 // Carousel initialization
 
 // add animate.css class(es) to the elements to be animated
 function setAnimation(_elem, _InOut) {
  // Store all animationend event name in a string.
  // cf animate.css documentation
  var animationEndEvent = 'webkitAnimationEnd mozAnimationEnd MSAnimationEnd oanimationend animationend';

  _elem.each(function() {
   var $elem = $(this);
   var $animationType = 'animated ' + $elem.data('animation-' + _InOut);

   $elem.addClass($animationType).one(animationEndEvent, function() {
    $elem.removeClass($animationType); // remove animate.css Class at the end of the animations
   });
  });
 }

 // Fired before current slide change
 owl.on('change.owl.carousel', function(event) {
  var $currentItem = $('.owl-item', owl).eq(event.item.index);
  var $elemsToanim = $currentItem.find("[data-animation-out]");
  setAnimation($elemsToanim, 'out');
 });

 // Fired after current slide has been changed
 owl.on('changed.owl.carousel', function(event) {

  var $currentItem = $('.owl-item', owl).eq(event.item.index);
  var $elemsToanim = $currentItem.find("[data-animation-in]");
  setAnimation($elemsToanim, 'in');
 })

});

// second slider owl carousel 2

 $(function() {
  // Owl Carousel 2
 $('.slider-2').owlCarousel({
 loop: true,
 margin: 30,
 nav: false,
 items: 1,
 dots: false,
 autoplay: true,
 autoplayTimeout: 15000,
 smartSpeed: 3000,
 });
 
 });
