var Equation = require("./Equation").Equation,
    glMatrix = require('gl-matrix'),
    vec2 = glMatrix.vec2,
    glMatrixExtensions = require('../gl-matrix-extensions'),
    vec2e = glMatrixExtensions.vec2;

exports.ContactEquation = ContactEquation;

/**
 * Non-penetration constraint equation.
 *
 * @class ContactEquation
 * @constructor
 * @extends Equation
 * @param {Body} bi
 * @param {Body} bj
 */
function ContactEquation(bi,bj){
    Equation.call(this,bi,bj,0,1e6);
    this.penetration = 0.0;
    this.ri = vec2.create();
    this.penetrationVec = vec2.create();
    this.rj = vec2.create();
    this.ni = vec2.create();
    this.rixn = vec2.create();
    this.rjxn = vec2.create();
    this.rixw = vec2.create();
    this.rjxw = vec2.create();
    this.relVel = vec2.create();
    this.relForce = vec2.create();
};
ContactEquation.prototype = new Equation();
ContactEquation.prototype.constructor = ContactEquation;
ContactEquation.prototype.computeB = function(a,b,h){
    var bi = this.bi,
        bj = this.bj,
        ri = this.ri,
        rj = this.rj,
        xi = bi.position,
        xj = bj.position;

    var vi = bi.velocity,
        wi = bi.angularVelocity,
        fi = bi.force,
        taui = bi.angularForce;

    var vj = bj.velocity,
        wj = bj.angularVelocity,
        fj = bj.force,
        tauj = bj.angularForce;

    var relVel = this.relVel,
        relForce = this.relForce,
        penetrationVec = this.penetrationVec,
        invMassi = bi.invMass,
        invMassj = bj.invMass,
        invIi = bi.invInertia,
        invIj = bj.invInertia,
        n = this.ni;

    // Caluclate cross products
    var rixn = this.rixn = vec2e.crossLength(ri,n);
    var rjxn = this.rjxn = vec2e.crossLength(rj,n);

    // Calculate q = xj+rj -(xi+ri) i.e. the penetration vector
    vec2.set(penetrationVec,0,0);
    vec2.add(penetrationVec,xj,rj);
    vec2.sub(penetrationVec,penetrationVec,xi);
    vec2.sub(penetrationVec,penetrationVec,ri);

    var Gq = vec2.dot(n,penetrationVec);

    // Compute iteration
    var GW = vec2.dot(vj,n) - vec2.dot(vi,n) + wj * rjxn - wi * rixn;
    var GiMf = vec2.dot(fj,n)*invMassj - vec2.dot(fi,n)*invMassi + invIj*tauj*rjxn - invIi*taui*rixn;

    var B = - Gq * a - GW * b - h*GiMf;

    return B;
};
// Compute C = GMG+eps in the SPOOK equation
ContactEquation.prototype.computeC = function(eps){
    var bi = this.bi;
    var bj = this.bj;
    var rixn = this.rixn;
    var rjxn = this.rjxn;
    var invMassi = bi.invMass;
    var invMassj = bj.invMass;

    var C = invMassi + invMassj + eps;

    var invIi = bi.invInertia;
    var invIj = bj.invInertia;

    // Compute rxn * I * rxn for each body
    C += invIi * rixn * rixn;
    C += invIj * rjxn * rjxn;

    return C;
};
var computeGWlambda_ulambda = vec2.create();
ContactEquation.prototype.computeGWlambda = function(){
    var bi = this.bi;
    var bj = this.bj;
    var ulambda = computeGWlambda_ulambda;

    var GWlambda = 0.0;
    vec2.sub( ulambda,bj.vlambda, bi.vlambda);
    GWlambda += vec2.dot(ulambda,this.ni);

    // Angular
    GWlambda -= bi.wlambda * this.rixn;
    GWlambda += bj.wlambda * this.rjxn;

    return GWlambda;
};

var addToWlambda_temp = vec2.create();
ContactEquation.prototype.addToWlambda = function(deltalambda){
    var bi = this.bi;
    var bj = this.bj;
    var rixn = this.rixn;
    var rjxn = this.rjxn;
    var invMassi = bi.invMass;
    var invMassj = bj.invMass;
    var n = this.ni;
    var temp = addToWlambda_temp;

    // Add to linear velocity
    vec2.scale(temp,n,invMassi*deltalambda);
    vec2.sub( bi.vlambda,bi.vlambda, temp );

    vec2.scale(temp,n,invMassj*deltalambda);
    vec2.add( bj.vlambda,bj.vlambda, temp);

    // Add to angular velocity
    bi.wlambda -= bi.invInertia * rixn * deltalambda;
    bj.wlambda += bj.invInertia * rjxn * deltalambda;
};

