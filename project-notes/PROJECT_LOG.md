# Project log

Keep this up to date as you go — a few lines per work session is enough. It's much harder to reconstruct at the end.

**Team name:** Nicholas Bergen
**Startup name:** CrystalBallStocks
**Live site link:** https://crystalballstocks.pages.dev/

---

## Work sessions

### Session — 11/26/26 — driver: Nicholas Bergen

- **Goal for this session:** improve the stock projection by including current news/event context and estimated trade costs.
- **Key prompts we gave Copilot:**
  1. make the model account for news, earnings, macroeconomic events, fees, or trading constraints
  2. use editable assumptions for fees, slippage, trade size, and minimum order; default to a $1,000 order, $0 commission, 0.1% slippage each way, and a $1 minimum
- **What worked:** added a limited, recent-headline sentiment tilt and event-based range widening, plus an editable hypothetical net-return estimate and minimum-order check.
- **What broke, and how we fixed it:** no reliable earnings/economic calendar or broker rules are configured, so the interface and methodology identify event matching and trading costs as heuristics/assumptions rather than complete coverage.
- **Committed?** no — changes are in the working tree.

### Session — 11/26/26 — driver: Nicholas Bergen

- **Goal for this session:** add login and logout features
- **Key prompts we gave Copilot** (paste the important ones): 
  1. when logged out can edit the last log in watchlist
  2. clear the watchlist and other settings when logged out
- **What worked:** clearing all when logging out 
- **What broke, and how we fixed it:** logged out didn't go to sign in when adding to wishlist. treating logged in adn out as different users.
- **Committed?** yes / no — commit message: yes 

---

### Session — 11/16/26 — driver: Nicholas Bergen

- **Goal for this session:** add more features and fake adds 
- **Key prompts we gave Copilot** (paste the important ones):
  1. add features such as exporting as csv and adding a profile page
  2. on the graph add a dot to see the current price and add a dropdown to select the stock
- **What worked:** all 
- **What broke, and how we fixed it:** didnt track mouse on the graph, shortend the gap in the data 
- **Committed?** yes / no — commit message: yes

---

### Session — 11/13/26 — driver: Nicholas Bergen

- **Goal for this session:** Create app and get it working on cloudflare instead of GitHub
- **Key prompts we gave Copilot** (paste the important ones):
  1. how do I connect python to an external api and cloudflare?
- **What worked:** changing the apis and getting rid of the email confirmation
- **What broke, and how we fixed it:** email and another server provider, changed to cloudflare and used yahoo finance
- **Committed?** yes / no — commit message: yes 

---

### Session — 11/12/26 — driver: Nicholas Bergen

- **Goal for this session:** add email verification
- **Key prompts we gave Copilot** (paste the important ones): 
  1. how do I create an email verification system for my website?
  2. what apis are there to send emails.
- **What worked:** connecting to the api
- **What broke, and how we fixed it:** wouldn't send emails. Needed a domain to send emails from the site.
- **Committed?** yes / no — commit message: no

---

## Things that broke (running list)

| Date     | What went wrong         | What we tried              | What finally fixed it                        |
|----------|-------------------------|----------------------------|----------------------------------------------|
| 11/12/26 | Simulated Data          | connecting to external lib | Used cloud flair to connect to the API       |
| 11/13/26 | Account Creation        | Wont send emails           | Use a internal database with no conformation |
| 11/16/26 | Login                   | internal database          | internal database                            |
| 11/26/26 | No Data                 | connecting to finance api  | changed api                                  |
| 11/26/26 | Profile                 | profile button             | added more functions                         |
| 11/26/26 | profile dropdown        | changed button             | changed button                               |
| 11/26/26 | Adds Shifted everything | creating grid              | Reverted and skipped the feature             |



## What a real version would need

Everything we wanted but faked or left out — real logins, a real database, payments, security, moderation, an app, staff, etc. For each one, say **why** it's needed and roughly **how hard or expensive** you think it would be.

| Feature we faked or skipped | Why a real company would need it                                  | How hard / expensive?                                                                                                                                                             |
|-----------------------------|-------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Email verification          | To ensure that users are real and prevent bots                    | fairly easy just need a domain and email api so you have an email to use to send the verification email                                                                           |
| Security                    | To protect a users personal data                                  | Harder and more expensive with protocol and other mesures to ensure that the data doesnt leave the server without an encryption                                                   |
| Adds                        | To make money of the site                                         | fairly easy just need and add account and api                                                                                                                                     |
| Prediction accuracy testing | The prediction might be wrong giving false positives to the price | Hard and expensive, were you would need to create a neural net of all predictions and actual outcomes to narrow the algorithm                                                     |
| paid Data and apis          | These databases and apis would have more information and features | Easy but expensive, with all of these databases you would need allot of storage to house the models and the free apis just dont offer the amount of features that you woulds want |

## Reflection (fill in at the end)

1. What surprised you most about building software with AI?
How easy it was to get a working site and how easy it was to change style such as the entire colour scheme of the site, and buttons that would be put out of place and move/resize them. Whis is much easier compared to manual editing of the css and other files where you would have to make sure your of the right file that covers that section and go through pages of line to get to where you can change the colour.
2. Which parts were easy, and which were hard? Why do you think that is?
Changing styles of the css and other files just saying a simple sentence, and it interprets it well and even makes some suggestions that are helpful to get an idea that I wouldn't have thought of. Getting cloud flair connected to the site and all the apis. Such as the email api where it wouldn't let me connect unless I got put into a secret store. This makes sure that the api key wouldn't be able to be accused by anyone looking at the git along with the private account that stores all the important information for the user.  Probably because I didn't have much experience in hosting and setting up sites like this and that co-pilot cant see it easily to give advice for setup.
3. If a competitor had the same AI tool, how long would it take them to copy your site?
Fairly easy minus maybe the certain algorithm I used to predict the stock prices, they might be able to get something similar, but the underlying properties that I used would be different. Where i used multiple different sources of information, such as the stock history, news, and other stocks in the same market to calculate the "projected" cost of the stock. But they could easily copy the site and make it look similar in a few days. On the methodology page, there is a diagram that shows how it estimates the projected price and how that it isn't always correct, but it is a good estimate of what the price could be. The site also has a wishlist where you can add stocks that you want to follow and see their projected prices along with current/ previous. This is a feature that might be easier to imitate but harder to copy because it would require a lot of data and algorithm analysis to get the same results. However, the feature itself of saving these entries wouldn't be too difficult.
