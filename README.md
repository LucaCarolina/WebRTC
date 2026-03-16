# WebRTC Smartphone-to-Desktop Control Project

## What this repository is
This repository contains a university project where a smartphone is used to control a desktop JavaScript experience through a WebRTC data channel.

The main goal of the project is to create a simple one-to-one connection between a desktop and a phone using a QR code. After connecting, the phone acts as a remote controller for the desktop experience.

For my concept, I decided to build a small interactive scene where the phone controls a laser pointer on the desktop screen and a cat follows that laser.

The project stays simple and easy to run:
- `npm install`
- `npm start`
- open the app on desktop(the terminal will output the localhost link)
- scan the QR code with the phone
- connect both devices
- use the phone as the controller


## Functional idea
The desktop is the main screen where the interaction is shown.

The phone is used as the controller.

WebSockets are only used for the signaling step, meaning they help the devices find each other and exchange the information needed to connect.

After that, the actual control data is sent through a WebRTC data channel, which is the core requirement of the project.


## Current MVP
Right now, the project proves these core things:
- a desktop and a phone can connect in a one-to-one setup
- the connection is started through a QR code
- the project runs from a local server started with `npm start`
- the phone can send control data to the desktop
- the desktop reacts to the input coming from the phone



## How it works
The desktop opens the project first and becomes the host.

A QR code is shown on the desktop page.

The phone scans the QR code and joins the same session.

The two devices complete the WebRTC handshake.

Once the connection is established, the phone sends small control messages to the desktop through the data channel.

The desktop reads those messages and updates the visual experience.


## Small code examples

Example of the phone sending control data:

```js
channel.send(JSON.stringify({
  type: "pointer",
  x: 0.42,
  y: 0.61,
  active: true
}));
```

In simple terms:
- `x` and `y` represent the position of the laser
- `active` tells the desktop if the pointer is currently being used

Example of the desktop creating the data channel before making the offer:

```js
dataChannel = peerConnection.createDataChannel("control");
const offer = await peerConnection.createOffer();
await peerConnection.setLocalDescription(offer);
```

This part is important because the data channel has to exist before the WebRTC offer is sent.


---

## Week 1
### Goal
Create the first working version of the one-to-one desktop and phone connection.

### What I worked on
During the first week, I focused on setting up the local project and getting the basic connection flow working.

I created the Node.js setup so the project can be started with `npm install` and `npm start`.

I added the local web server, the HTML/CSS/JavaScript frontend, and the signaling layer.

I also added QR code pairing so the phone could join the desktop session in a simple way.

### Result
By the end of this week, I had a basic WebRTC handshake working between desktop and phone.

The main achievement was reaching a confirmed connected state between the two devices.

### Reflection
This week was mostly about getting the technical foundation working before adding any actual interaction.


## Week 2
### Goal
Move from a basic connection demo toward an actual interactive project idea.

### What I worked on
In the second week, I started exploring what kind of desktop experience the phone could control.

I considered different ideas such as:
- touch input
- tilt input
- accelerometer-based control
- gyroscope-based control
- drawing or laser-pointer style interaction

After exploring these options, I moved toward the cat-and-laser concept because it was simple, visual, and easy to understand during a demo.

I also started thinking more carefully about the difference between WebSockets and WebRTC, and kept the project aligned with the requirement that WebSockets are only used for signaling.

### Result
The project direction became much clearer during this week.

Instead of staying as only a connection test, it became a real control-based experience with a defined concept.

### Reflection
This was an exploratory week. I spent more time deciding what should be built than trying to add too many features too early.


## Week 3
### Goal
Maintain progress if possible and review the project direction.

### What I worked on
I was sick during Week 3, so I was not able to make meaningful development progress.

Because of that, this week contains very little implementation work.



## Week 4
### Goal
Return to development, stabilize the main interaction, and test whether extra features can still be added.

### What I worked on
This week I returned to the project and focused again on the main idea: using the phone as a remote controller for the desktop scene.

The main priority is to make sure the base interaction works clearly and reliably:
- desktop opens as host
- phone joins through QR code
- WebRTC data channel connects
- phone sends control input
- desktop updates the experience

At this stage, I also want to see whether I can still add extra functionality if time allows.

Possible extra improvements for this week are:
- smoother cat movement
- cleaner UI feedback
- improved pointer behavior
- more stable connection handling
- optional extra control features if they remain simple enough

### Result
The main focus of this week is to turn the project from a prototype into a cleaner MVP.

### Reflection
At this point, I would rather have a simple project that works properly than a more advanced project with unstable features.


---



## Critical reflection on AI use
AI was used as a support tool during the development of this project.

I mainly used AI for:
- understanding WebRTC architecture
- generating or improving starter code
- troubleshooting networking and connection issues
- helping structure documentation and planning

Some parts of the code were AI-assisted, especially the early setup ideas for:
- WebRTC signaling flow
- QR pairing structure
- WebSocket and data channel logic

However, I did not simply copy everything directly without checking it.

I reviewed the generated code, tested it locally, and adjusted parts of it when needed.

The main areas where I modified or simplified AI-generated output were:
- adapting the code to the actual assignment requirements
- changing the interaction idea from more experimental sensor input toward a simpler phone-controller approach
- rewriting documentation into a clearer form that matches the project and course expectations

One important lesson from using AI in this project is that AI can generate working starting points quickly, but it can also make the project more complicated than necessary.

Because of that, I had to make decisions about what to keep, what to simplify, and what to remove.

In that sense, AI was helpful for acceleration and exploration, but I still needed to understand the code, test it, and make project-level decisions myself.


## Instructions to run the project
Install dependencies:

```bash
npm install
```

Start the local server:

```bash
npm start
```

Then:
1. open the project on the desktop browser
2. wait for the QR code to appear
3. scan the QR code with the smartphone
4. let both devices complete the connection
5. use the phone to control the desktop experience


## Plan for next week
My next step is to keep improving the stability and clarity of the MVP.

The main priorities are:
- confirm that the one-to-one connection works reliably
- improve the desktop interaction feedback
- make the phone controls feel cleaner
- test whether one or two extra features can be added without breaking the simplicity of the project

If possible, I would also like to experiment with bonus features, but only if the minimum version is already stable.


## Change log
- v0.1: Initial scaffold with local server and project setup
- v0.2: QR pairing and basic signaling flow
- v0.3: Working one-to-one WebRTC connection between desktop and phone
- v0.4: Shift from a technical starter to an actual phone-controlled interaction concept
- v0.5: Current MVP direction focused on the cat-and-laser idea
