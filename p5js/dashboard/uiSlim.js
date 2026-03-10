


/*
*
* UI SLIM by www.hobye.dk
*
*
*/


/*
 todo:
 - dynamic styling
 - relative positioning
 - horizontal container.
 - Draggable
 - mouse as an object.
 - onUp onDown
 - key bindings
 */




var uiMPOld = false;
var uiMXOld = 0;
var uiMYOld = 0;
var uiMX = 0;
var uiMY = 0;
var uiSWidth = 0;
var uiSHeight = 0;
var uiPressedUP = false;
var uiMP = false;
var uiKey;
var stack = [];

class uiFloat
{


  constructor(val)
  {
    this.val = val;
  }

   set( newVal)
  {
    this.val = newVal;
  }

   get()
  {
    return this.val;
  }
}


function uiUpdateSimple()
{
  uiUpdate(mouseX, mouseY, mouseIsPressed, key, width, height);


  
}

function uiUpdate(_mouseX, _mouseY, _mousePressed, _key, screenWidth, screenHeight) {
  stack = [];
  uiSWidth = screenWidth;
  uiSHeight = screenHeight;
  uiMXOld = _mouseX;
  uiMYOld = _mouseY;
  uiMPOld = uiMP;
  uiMX = _mouseX;
  uiMY = _mouseY;
  uiMP = _mousePressed;
  uiKey = _key;
}

function uiContainerStart(x = 0, y = 0, width = 200) {

  if (stack.length > 0) {
    var parentContainer = getCont();
    return uiContainerStart(parentContainer.x, parentContainer.currentY + parentContainer.margin, parentContainer.width);

  }
  var uiO = new uiObj();

  uiO.x = x;
  uiO.y = y;

  uiO.width = width;

  stack.push(uiO);
  return uiO;
}

function uiContainerEnd() {
  var container = getCont();
  noFill();
  stroke(255);
  rect(container.x - container.margin, container.y - container.margin, container.width + container.margin * 2, container.currentY + container.margin * 2);
  stack.pop();
}

function uiButton(name) {
  return uiButton(name, color(255));
}

function uiButton(name, bgColor = 255, width = 200, height = 30, x=undefined, y=undefined) {

  if (x == undefined) {
    var container = getCont();
    x = container.x;
    width = container.width;
    y = container.currentY + container.y;
    container.currentY = container.currentY + height + container.margin;
  }

  var uiobj = uiCompileInteractive(x, y, width, height);


  uiRectStyling();
  if (uiobj.hover) {
    fill(100);

    if (uiobj.pressed) {
      fill(50);
    }
  } else {

    fill(bgColor);
    
  }
  
 

  rect(uiobj.x, uiobj.y,uiobj.width, uiobj.height);
  if (uiobj.pressed) {
    fill(255);
  } else {
    fill(0);
  }
  uiTextStyling();
  text(name, x + 10, y + 20);

  return uiobj;
}


function uiToggle(name, value,  bgColor = 255, width = 200, height = 30, x=undefined, y=undefined) {

  if (x == undefined) {
    var container = getCont();
    x = container.x;
    width = container.width;
    y = container.currentY + container.y;
    container.currentY = container.currentY + height + container.margin;
  }

  var uiobj = uiCompileInteractive(x, y, width, height);

  /*if(uiobj.clicked)
  {
    value = !value;
  }*/
  uiRectStyling();
  if (uiobj.hover) {
    fill(100);

    if (uiobj.pressed) {
      fill(50);
    }
  } else {

    fill(bgColor);
    
  }
  
  
  
 

  rect(uiobj.x, uiobj.y,uiobj.width, uiobj.height);
  if (uiobj.pressed) {
    fill(255);
  } else {
    fill(0);
  }
  uiTextStyling();
  if(value)
  {
     text("x", x + 10, y + 20);
  }
  else
  {
   // text("-", x + 10, y + 20);
  }
  text(name, x + 10+15, y + 20);

  return uiobj;
}

function uiScrollbar(name, min = 0, max = 100, value=undefined, width = 200, x=undefined, y=undefined) {
  height = 30;
  if (x == undefined) {

    var container = getCont();
    x = container.x;
    width = container.width;
    y = container.currentY + container.y;
    container.currentY = container.currentY + height + container.margin;
  }


  var uiobj = uiCompileInteractive(x, y, width, height);

  if (uiobj.hover && uiobj.pressed) {
    value.set(map(uiobj.mX, 0, uiobj.width, min, max));
  }
  uiRectStyling();
  rect(x, y, uiobj.width, uiobj.height);
  fill(255, 100, 100);
  rect(x, y, map(constrain(value.get(), min, max), min, max, 0, uiobj.width), uiobj.height);
  uiTextStyling();
  text(name+ " (" + roundToTwo(value.get(),2)+")", x + 10, y + 20);

  return uiobj;
}

function roundToTwo(num) {
    return +(Math.round(num + "e+2")  + "e-2");
}

function uiText(name, fontSize = 15) {
  var container = getCont();
  var uiobj = uiText(name, container.currentX + container.x, container.currentY + container.y, container.width, fontSize);

  container.currentY = container.currentY + uiobj.height + container.margin;
  return uiobj;
}

function uiText(name, fontSize = 15, width = 200, x=undefined, y=undefined) {
  height = 30;
  if (x == undefined) {

    var container = getCont();
    x = container.x;
    width = container.width;
    y = container.currentY + container.y;
    container.currentY = container.currentY + height + container.margin;
  }

  var uiobj = uiCompileInteractive(x, y, width, 30);
  uiTextStyling();
  fill(255);
  textSize(fontSize);
  text(name, x, y + 20);

  return uiobj;
}


function uiJoystick(name, min, max, joyX, joyY, x, y, size = 200) {
  if (x == undefined) {

    var container = getCont();
    x = container.x;
    size = container.width;
    y = container.currentY + container.y;
    container.currentY = container.currentY + size + container.margin;
  }

  var ballSize = 40;
  var uiobj = uiCompileInteractive(x, y, size, size);

  stroke(255);
  noFill();
  ellipse(x + size / 2, y + size / 2, size, size);
  fill(200);


  if (uiobj.hover && uiobj.pressed) {
    fill(255, 100, 100);
    joyX.set(map(uiMX - (x + size / 2), -size / 2, size / 2, min, max));
    joyY.set(map(uiMY - (y + size / 2), -size / 2, size / 2, min, max));
  } else {
    joyX.set(0);
    joyY.set(0);
  }


  noStroke();
  ellipse(x + size / 2 + map(joyX.get(), min, max, -size / 2, size / 2), y + size / 2 + map(joyY.get(), min, max, -size / 2, size / 2), ballSize, ballSize);

  return uiobj;
}

function uiCompileInteractive(x, y, width, height) {
  var uiobj = new uiObj();

  uiobj.x = x;
  uiobj.y = y;
  uiobj.mX = uiMX - x;
  uiobj.mY = uiMY - y;
  uiobj.width = width;
  uiobj.height = height;
  uiobj.hoverOld = (uiMXOld > x && uiMYOld > y && uiMXOld < x + width && uiMYOld < y + height);
  uiobj.hover = (uiMX > x && uiMY > y && uiMX < x + width && uiMY < y + height);

  uiobj.pressed = uiobj.hover && uiMP;
  uiobj.pressedOld = uiobj.hoverOld && uiMPOld;
  uiobj.pressedDown = uiobj.hover && uiMP && !uiMPOld;
  uiobj.dragging = uiobj.hover && uiobj.pressed && uiobj.pressedOld && (uiMYOld != uiMY || uiMXOld != uiMX);
  uiobj.clicked = !uiobj.dragging && uiobj.hover && !uiMP && uiMPOld; // not perfect.
  uiobj.pressedUp = (!uiobj.hover && uiobj.hoverOld) || (uiobj.hover && !uiobj.pressed && uiMPOld);
  return uiobj;
}

function getCont() {
  if (stack.length == 0) {
    uiContainerStart();
  }
  return stack[stack.length - 1];
}

function uiRectStyling() {
  noStroke();
  fill(255);
}

function uiTextStyling() {

  fill(0);
  textSize(15);
  noStroke();
}




class uiPosition {
  constructor() {
    this.x = 0;
    this.y = 0;
  }
}

class uiObj {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.mX = 0;
    this.mY = 0;
    this.width = 0;
    this.height = 0;
    this.clicked = false;
    this.pressed = false;
    this.pressedOld = false;

    this.hover = false;
    this.hoverOld = false;
    this.dragging = false;
    this.pressedUp = false;
    this.pressedDown = false;

    this.currentX = 0;
    this.currentY = 0;
    this.margin = 10;
  }


}



var uiJoyX = new uiFloat(0);
var uiJoyY = new uiFloat(0);
var uiScrollValue = new uiFloat(0);

function uiDemo() {

  uiContainerStart(width - 200, 30, 150);

  uiText("DEMO");
  if (uiButton("Button one").clicked) {
    print("Button one");
  }

  if (uiButton("STOP!", color(255, 0, 0)).clicked) {
    print("Stop");
  }

  uiText("Some text");

  if (uiScrollbar("Scrollbar", 0, 100, uiScrollValue).clicked) {
    print("Scrollbar value: " + uiScrollValue.get());
  }

  var joyobj = uiJoystick("2D control", -100, 100, uiJoyX, uiJoyY);

  if (joyobj.pressed) {
    print("joystick: " + uiJoyX.get() + "," + uiJoyY.get());
  }


  uiContainerEnd();
}

var scrollValue = new uiFloat(0);
function drawLeftPanel() {
  uiUpdateSimple();
  uiContainerStart(30, 30, 150);

  uiText("Controlpanel");
  if (uiButton("Full screen").clicked) {
    fullScreenToggle();
  }
  
  uiScrollbar("Background", 0, 255, scrollValue);
  
  uiContainerEnd();
}
